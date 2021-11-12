#!/usr/bin/env node

/**
 * Module dependencies.
 */
var express = require('express');

var app = express();

var debug = require('debug')('marketmadeapi:server');
var http = require('http');

/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(process.env.PORT || '3001');
app.set('port', port);

/**
 * Create HTTP server.
 */

var server = http.createServer(app);

const { Server } = require("socket.io")

const io = new Server(server);

const gameNameSpace = io.of('/game')
/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
    var port = parseInt(val, 10);

    if (isNaN(port)) {
        // named pipe
        return val;
    }

    if (port >= 0) {
        // port number
        return port;
    }

    return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    var bind = typeof port === 'string'
        ? 'Pipe ' + port
        : 'Port ' + port;

    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(bind + ' requires elevated privileges');
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.error(bind + ' is already in use');
            process.exit(1);
            break;
        default:
            throw error;
    }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
    var addr = server.address();
    var bind = typeof addr === 'string'
        ? 'pipe ' + addr
        : 'port ' + addr.port;
    debug('Listening on ' + bind);
}


var createError = require('http-errors');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var loki = require('lokijs');
var cors = require('cors')

function isTransaction(order1, order2) {
    if (order2 === undefined || order1 === undefined) {
        console.log("undefined order")
        return false;
    }
    if (order1.isBid === order2.isBid) {
        return false;
    }

    const lowerPrice = order1.price >= order2.price ? order2 : order1;
    const higherPrice = order1.price < order2.price ? order2 : order1;

    return !lowerPrice.isBid || lowerPrice.price === higherPrice.price;
}

function createTick(order1, order2, transactedVolume, bidWasAggressor) {
    const bid = order1.isBid ? order1 : order2
    const ask = !order1.isBid ? order1 : order2
    return {
        price: order2.price,
        volume:transactedVolume,
        buyer:bid.name,
        bidWasAggressor,
        seller:ask.name,
        timestamp: new Date().getTime()
    }
}

// orders should be sorted by most aggressive price first
function makeTransactions(order, orderInsertList, orders        , tickList        , ordersById, playerData) {

}

function sortedIndex(array, value, compareFun) {
    var low = 0,
        high = array.length;

    while (low < high) {
        var mid = (low + high) >>> 1;
        if (compareFun(array[mid]) < compareFun(value)) low = mid + 1;
        else high = mid;
    }
    return low;
}

function insertSorted(array, value, compareFun) {
    array.splice(sortedIndex(array, value, compareFun), 0, value)
}

function sendError(socket, message) {
    console.log(message)
    socket.emit('erroneousAction', {message:message || "No message"});
}
function emitToMarket(socket, event, object) {
    console.log("emitted", event, object)
    object.transactionId = socket.gameState.transactionSequence++
    socket.to(socket.gameId).emit(event, object)
    socket.emit(event, object)
}

function makePlayerData(name) {
    return {
        name,
        longPosition: 0,
        shortPosition: 0,
        scrapeProfit: 0,
        totalLongVolume: 0,
        totalShortVolume: 0,
        bidTicks:[],
        askTicks:[]
    };
}

function getScrapedValue(bidTicks, askTicks) {
    let bidIndex = bidTicks.length - 1
    let askIndex = askTicks.length - 1
    let iterBid = bidTicks[bidIndex];
    let iterAsk = askTicks[askIndex];
    let value = 0;
    while (iterBid && iterAsk) {
        let transactVolume = Math.min(iterBid.volume, iterAsk.volume);
        value += (iterAsk.price - iterBid.price) * transactVolume
        iterBid.volume -= transactVolume
        iterAsk.volume -= transactVolume

        if (iterBid.volume === 0) {
            bidTicks.pop()
            bidIndex -= 1
        }
        if (iterAsk.volume === 0) {
            askTicks.pop()
            askIndex -= 1
        }

        iterBid = bidTicks[bidIndex];
        iterAsk = askTicks[askIndex];
    }
    return value;
}

gameNameSpace.on('connection', (socket) => {

    socket.on('joinGame', (gameId, name)=>{
        gameId = Number(gameId);
        const gameState = gamesTable.findOne({gameId});
        if (gameState === null) {
            sendError(socket, "cant join game doens't exist");
            return;
        }
        socket.gameState = gameState;
        socket.join(gameId)
        socket.gameId = gameId;
        console.log(name,  'joined')
        socket.name = name;
        gameState.parties.push(name);
        const playerData = makePlayerData(name)
        gameState.playerData[name] = playerData
        emitToMarket(socket, "gameJoin", name);
        console.log("gamestate emitted", renderGameState(gameState))
        socket.emit('gameState', renderGameState(gameState));
        emitToMarket(socket, "playerDataUpdate", playerData)
    })

    socket.on('insertOrder', ({price, volume, isBid}) => {
        console.log("testing")
        if (socket.gameState === undefined) {
            sendError(socket, "undefined socket");
            return;
        }
        //const outstandingOrders = socket.gameState.outstandingBids.concat(socket.gameState.outstandingAsks);
        price = Number(price)
        volume = Number(volume)

        if (volume < 0 || price < 0 || isNaN(price) || isNaN(volume) || typeof isBid != 'boolean') {
            return sendError(socket);
        }
        const {orderInfo, gameId, playerData} = socket.gameState

        const orderId = orderInfo.orderIdSequence++
        const outstandingOrder = {price, volume, isBid, originalVolume:volume,
            orderId, name:socket.name,
            gameId:gameId};


        const {bids, asks, ordersById} = orderInfo

        const ticks = orderInfo.ticks

        //makeTransactions(outstandingOrder, !isBid ? asks : bids , isBid ? asks : bids, ticks, ordersById)

        let {volume:outstandingVolume} = outstandingOrder;
        const orderInsertList = !isBid ? asks : bids;
        const orders = isBid ? asks : bids;
        const updates = []

        //console.log("istransaction", isTransaction(outstandingOrder, orders[0]), outstandingOrder, orders[0])
        while (outstandingVolume > 0 && orders.length > 0 && isTransaction(outstandingOrder, orders[0])) {
            const aggressiveStandingOrder = orders[0]
            const transactedVolume = Math.min(aggressiveStandingOrder.volume, outstandingVolume)
            aggressiveStandingOrder.volume -= transactedVolume
            outstandingVolume -= transactedVolume;
            const tick = createTick(outstandingOrder, aggressiveStandingOrder, transactedVolume, outstandingOrder.isBid)

            ticks.push(tick);
            updates.push(['onTick', tick])

            const {buyer, seller, price, volume} = tick;
            let buyerData = playerData[buyer];
            let sellerData = playerData[seller];
            buyerData.longPosition += price*volume
            sellerData.shortPosition += price * volume
            buyerData.totalLongVolume += volume
            sellerData.totalShortVolume += volume
            insertSorted(buyerData.bidTicks, {price,volume}, ({price})=>-price)
            insertSorted(sellerData.askTicks, {price,volume}, ({price})=>price)
            buyerData.scrapedValue = getScrapedValue(buyerData.bidTicks, buyerData.askTicks)
            sellerData.scrapedValue = getScrapedValue(sellerData.bidTicks, sellerData.askTicks)
            updates.push(['playerDataUpdate', buyerData])
            updates.push(['playerDataUpdate', sellerData])

            if (aggressiveStandingOrder.volume <= 0) {
                orders.shift();
            }

            // clients should handle volume 0 as removal
            updates.push(['orderUpdate', aggressiveStandingOrder]);
        }
        if (outstandingVolume > 0) {
            updates.push(['orderInsert', outstandingOrder])
            outstandingOrder.volume = outstandingVolume
            const multiplier = outstandingOrder.isBid ? -1 : 1;
            insertSorted(orderInsertList, outstandingOrder, (isBid ? ({price}) => -price : ({price}) => price))
            ordersById[outstandingOrder.orderId] = outstandingOrder;
        }

        updates.forEach(([event, update]) => {
            emitToMarket(socket, event,update)
        })

        console.log('outstandingOrder inserted')
    })

    socket.on('cancelOrder', (id) => {
        if (socket.gameState === undefined) {
            sendError(socket, "cancel order game state does note exist");
            return;
        }
        const {ordersById} = socket.gameState.orderInfo

        console.log(socket.gameState)

        const order = ordersById[id]

        if (order === undefined) {
            sendError(socket, "order does not exist")
            return;
        }

        order.volume = 0;
        const {bids,asks} = socket.gameState.orderInfo
        const orderList = order.isBid ? bids : asks;

        const index = orderList.indexOf(order);
        if (index > -1) {
            orderList.splice(index, 1);
        }


        emitToMarket(socket, 'orderUpdate', order)
    })

    });

const gamesRouter = express.Router();

const db        = new loki('Example');


let gameIndex = 0;
const gamesTable  = db.addCollection('games', {indices: 'gameId'});
const ordersTable  = db.addCollection('orders', {indices: ['gameId','orderId']});
const ticksTable  = db.addCollection('ticks', {indices: ['gameId','buyer','seller']});

const gameOrders = {}
const gameTicks = {}


app.use(cors());
// view engine setup
app.set('views', path.join(__dirname, 'views'));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


function createGameFor(gameName, gameMinutes) {
    let gameId = gameIndex++;

    // dynamic views aren't handled in a particularly clever way, each view being added is another lookup per update on the dataset
    const orderInfo = {
        bids:[],
        asks:[],
        ticks:[],
        orderIdSequence:0,
        ordersById:{}
    }

    gameOrders[gameId] = orderInfo;

    return {gameName, gameMinutes:Number(gameMinutes), gameId, parties:[], orderInfo, playerData:{}, transactionSequence:0};
}


function renderGameState(gameState) {
    const {gameName, gameMinutes, gameId, parties, orderInfo, playerData} = gameState
    return {
        gameName, gameMinutes, gameId, parties, playerData:{...playerData,
            "CHT":makePlayerData("CHT"),
            "ARP":makePlayerData("ARP"),
        }, bids:orderInfo.bids, asks:orderInfo.asks, ticks:orderInfo.ticks,
    };
}


gamesRouter.post('/', function(req, res) {
    try {
        const {gameName, gameMinutes} = req.body;
        if (!(gameName && gameMinutes) || isNaN(Number(gameMinutes))) {
            res.status(400).send({errorMessage: 'Invalid request'});
        }
        const newGame = createGameFor(gameName, gameMinutes);
        gamesTable.insert(newGame);
        res.status(200).send({gameId: newGame.gameId})
    } catch ( e) {
        console.log(e)
    }
});

app.use('/game', gamesRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
