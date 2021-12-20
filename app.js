#!/usr/bin/env node

/**
 * Module dependencies.
 */
var express = require('express');
const fs = require('fs');

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

const gameNameSpace = io.of('/ws')
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

// I just changed this but idk what I did come back here
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
function makeTransactions(order, orderInsertList, orders : Array, tickList : Array, ordersById, playerData) {

}
function sortedIndex(array, value, compareFun) {
    var low = 0,
        high = array.length;

    while (low < high) {
        var mid = (low + high) >>> 1;
        if (compareFun(array[mid]) < compareFun(value)) low = mid + 1;
        else high = mid;
    }

    let movingIndex = low;
    let finalSortValue = compareFun(value);
    while (movingIndex < array.length && compareFun(array[movingIndex]) === finalSortValue) {
        movingIndex++;
    }

    return movingIndex;
}

function insertSorted(array, value, compareFun) {
    let insertIndex = sortedIndex(array, value, compareFun);
    array.splice(insertIndex, 0, value)
    return insertIndex
}

function sendError(socket, message) {
    console.log("Error sent: ", message)
    socket.emit('erroneousAction', {message:message || "No message"});
}

function recordGameDataTransaction(transaction, gameId) {
    fs.appendFile(`game_data/${gameId}`, JSON.stringify(transaction) + "\n", function (err) {
        if (err) throw err;
    });
}

function emitToMarket(socket, event, object) {
    console.log("emitted", event, object)
    object.transactionId = socket.gameState.transactionSequence++
    object.ackTimestamp = new Date().getTime()
    recordGameDataTransaction([event, object], socket.gameState.gameId)
    socket.to(socket.gameId).emit(event, object)
    socket.emit(event, object)
}

function makePlayerData(name) {
    return {
        name,
        longPosition: 0,
        shortPosition: 0,
        totalOutstandingLongVolume: 0,
        totalOutstandingShortVolume: 0,
        scrapeProfit: 0,
        totalLongVolume: 0,
        totalShortVolume: 0,
        outstandingBids: {},
        outstandingAsks: {},
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

function renderGameView(gameState) {
    const {gameMinutes, gameName, parties} = gameState
    return {gameMinutes, gameName, parties};
}

function countDecimals(value) {
    if (Math.floor(value) !== value)
        return value.toString().split(".")[1].length || 0;
    return 0;
}


function coerceToPrice(number, tickSize, tickDecimals) {
    const closestMatch =  Math.round(number / tickSize) * tickSize
    if (Math.abs((closestMatch - number) / tickSize) >= 0.1) {
        return undefined;
    }
    console.log(number, tickSize, tickDecimals, closestMatch, closestMatch.toFixed(tickDecimals))
    return closestMatch.toFixed(tickDecimals);
}

gameNameSpace.on('connection', (socket) => {

    socket.on('viewGame', (gameId) => {
        gameId = Number(gameId);
        const gameState = gamesTable.findOne({gameId});
        if (gameState === null) {
            sendError(socket, "cant join game doesn't exist");
            return;
        }
        socket.gameState = gameState;
        socket.emit('gameView', renderGameView(gameState));
    })

    socket.on('joinGame', (name)=>{
        const gameState = socket.gameState
        const gameId = gameState
        if (!gameState) {
            sendError(socket, "cant join game doens't exist");
            return;
        }
        socket.join(gameId)
        socket.gameId = gameId;
        console.log(name,  'joined')
        socket.name = name;
        let renderedGameState = renderGameState(gameState);
        if (gameState.parties.indexOf(name) !== -1) {
            const playerData = gameState.playerData[name]
            socket.emit("youJoined", playerData)
            socket.emit("gameState", renderedGameState)
            console.log("Rejoin", playerData)
            return;
        }
        gameState.parties.push(name);
        const playerData = makePlayerData(name)
        gameState.playerData[name] = playerData
        emitToMarket(socket, "gameJoin", {name});
        socket.emit("youJoined", playerData)
        renderedGameState = renderGameState(gameState);
        console.log("gamestate emitted", renderedGameState)
        socket.emit('gameState', renderedGameState);
        emitToMarket(socket, "playerDataUpdate", playerData)
    })


    socket.on('pullOrders', () => {
        if (socket.gameState === undefined) {
            sendError(socket, "undefined socket");
            return;
        }

        let gameState = socket.gameState;
        const user = socket.name
        console.log(gameState)
        const playerData = gameState.playerData[user]
        console.log("orders pulled, playerdata", playerData)
        Object.values(playerData.outstandingBids)
            .concat(Object.values(playerData.outstandingAsks))
            .forEach(order => cancelOrder(order))
    })

    socket.on('insertOrder', ({price, volume, isBid}) => {
        if (socket.gameState === undefined) {
            sendError(socket, "undefined socket");
            return;
        }
        //const outstandingOrders = socket.gameState.outstandingBids.concat(socket.gameState.outstandingAsks);
        console.log("numebr is ", price)
        price = coerceToPrice(Number(price),socket.gameState.tickSize, socket.gameState.tickDecimals)

        if (price === undefined) {
            sendError(socket, "Price does not conform to tick size")
            return;
        }
        volume = Number(volume)

        if (volume < 0 || price < 0 || isNaN(price) || isNaN(volume) || typeof isBid != 'boolean') {
            return sendError(socket, "Invalid order, " + JSON.stringify({price, volume, isBid}));
        }
        const {orderInfo, gameId, playerData} = socket.gameState

        const orderId = orderInfo.orderIdSequence++
        const outstandingOrder = {
            price, volume, isBid, originalVolume:volume,
            orderId, name:socket.name,
            gameId:gameId};


        const {bids, asks, ordersById} = orderInfo

        const ticks = orderInfo.ticks

        //makeTransactions(outstandingOrder, !isBid ? asks : bids , isBid ? asks : bids, ticks, ordersById)

        let {volume:outstandingVolume} = outstandingOrder;
        const orderInsertList = !isBid ? asks : bids;
        const orders = isBid ? asks : bids;
        let updates = []
        let flushUpdates = () => {
            updates.forEach(([event, update]) => {
                emitToMarket(socket, event, update)
            })
            updates = []
        };
        //console.log("istransaction", isTransaction(outstandingOrder, orders[0]), outstandingOrder, orders[0])
        while (outstandingVolume > 0 && orders.length > 0 && isTransaction(outstandingOrder, orders[0])) {
            const aggressiveStandingOrder = orders[0]
            if (aggressiveStandingOrder.name === socket.name) {
                flushUpdates();
                sendError(socket, "Self trade");
                return;
            }

            const transactedVolume = Math.min(aggressiveStandingOrder.volume, outstandingVolume)
            aggressiveStandingOrder.volume -= transactedVolume
            outstandingVolume -= transactedVolume;
            const tick = createTick(outstandingOrder, aggressiveStandingOrder, transactedVolume, outstandingOrder.isBid)

            ticks.push(tick);
            updates.push(['onTick', tick])

            const {buyer, seller, price, volume} = tick;
            let buyerData = playerData[buyer];
            let sellerData = playerData[seller];
            let priceVol = price*volume;

            buyerData.longPosition += priceVol
            sellerData.shortPosition += priceVol
            buyerData.totalLongVolume += volume
            sellerData.totalShortVolume += volume
            buyerData.totalOutstandingLongVolume -= volume
            sellerData.totalOutstandingShortVolume -= volume

            insertSorted(buyerData.bidTicks, {price, volume}, ({price})=>-price)
            insertSorted(sellerData.askTicks, {price, volume}, ({price})=>price)
            buyerData.scrapedValue = getScrapedValue(buyerData.bidTicks, buyerData.askTicks)
            sellerData.scrapedValue = getScrapedValue(sellerData.bidTicks, sellerData.askTicks)
            updates.push(['playerDataUpdate', buyerData])
            updates.push(['playerDataUpdate', sellerData])

            if (aggressiveStandingOrder.volume <= 0) {
                orders.shift();
            }

            // clients should handle volume 0 as removal
            updates.push(['orderUpdate', aggressiveStandingOrder]);
            if (aggressiveStandingOrder.volume === 0) {
                // todo come back here hope this works
                delete ordersById[aggressiveStandingOrder.orderId];
            }
        }
        console.log("orders", orderInsertList)

        // todo refactor? Probably the only place bids will come from though. Much of this function needs modularising :dissapointed:

        if (outstandingVolume > 0) {
            outstandingOrder.volume = outstandingVolume

            let insertIndex = sortedIndex(orderInsertList, outstandingOrder, (isBid ? ({price}) => -price : ({price}) => price));

            const preElem = orderInsertList[insertIndex - 1]

            let playerDatum = playerData[socket.name];
            console.log("orders now", insertIndex, orderInsertList, playerData)
            console.log("preelem is", preElem, outstandingOrder)
            if (preElem && preElem.name === socket.name && preElem.price === outstandingOrder.price) {
                preElem.volume += outstandingOrder.volume
                preElem.originalVolume += outstandingOrder.volume
                updates.push(['orderUpdate', preElem])
            } else {
                updates.push(['orderInsert', outstandingOrder])
                orderInsertList.splice(insertIndex, 0, outstandingOrder)
                ordersById[outstandingOrder.orderId] = outstandingOrder;
                (isBid ? playerDatum.outstandingBids : playerDatum.outstandingAsks)[outstandingOrder.orderId] = outstandingOrder
            }
            if (isBid) {
                playerDatum.totalOutstandingLongVolume += outstandingVolume
            } else {
                playerDatum.totalOutstandingShortVolume += outstandingVolume
            }
        }

        flushUpdates()


        console.log("Orders by end", orderInsertList)
        console.log('outstandingOrder inserted')
    })

    function cancelOrder(order) {
        const id = order.orderId;
        order.volume = 0;
        let gameState = socket.gameState;
        const playerData = gameState.playerData[order.name]

        if (order.isBid) {
            playerData.totalOutstandingLongVolume -= order.volume
        } else {
            playerData.totalOutstandingShortVolume -= order.volume
        }

        const {bids, asks} = gameState.orderInfo
        const orderList = order.isBid ? bids : asks;
        console.log(playerData)
        delete (order.isBid ? playerData.outstandingBids : playerData.outstandingAsks)[order.orderId]

        const index = orderList.indexOf(order);
        /*
        where you were, place as 1 then 2 then 1 then cancel right to left
        todo
         */
        console.log("cancel id ", id, " is ", index, order)
        if (index > -1) {
            orderList.splice(index, 1);
        }

        emitToMarket(socket, 'orderUpdate', order)
    }

    socket.on('cancelOrder', (id) => {
        if (socket.gameState === undefined) {
            sendError(socket, "cancel order game state does note exist");
            return;
        }
        const {ordersById} = socket.gameState.orderInfo

        console.log(socket.gameState)

        const order = ordersById[id]

        if (order === undefined) {
            sendError(socket, "order does not exist" + id)
            return;
        }

        if (order.name !== socket.name) {
            sendError(socket, "order is not yours!"+ socket.name+ order+ id)
            return;
        }

        cancelOrder(order);
    })

    });

const gamesRouter = express.Router();

const db : Loki = new loki('Example');


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
    const tickSize = 0.1;
    // dynamic views aren't handled in a particularly clever way, each view being added is another lookup per update on the dataset
    const orderInfo = {
        bids:[],
        asks:[],
        ticks:[],
        orderIdSequence:0,
        ordersById:{}
    }

    gameOrders[gameId] = orderInfo;

    return {gameName, gameMinutes:Number(gameMinutes), gameId, parties:[], orderInfo, playerData:{}, transactionSequence:0, tickSize, tickDecimals:countDecimals(tickSize)};
}


function renderGameState(gameState) {
    const {gameName, gameMinutes, gameId, parties, orderInfo, playerData} = gameState
    // todo maybe dont copy playerdata
    return {
        gameName, gameMinutes, gameId, parties, playerData:{...playerData},
        bids:orderInfo.bids, asks:orderInfo.asks, ticks:orderInfo.ticks,
    };
}


gamesRouter.post('/', function(req, res) {
    console.log("game created", req.body);
    try {
        const {gameName, gameMinutes} = req.body;
        if (!(gameName && gameMinutes) || isNaN(Number(gameMinutes))) {
            res.status(400).send({errorMessage: 'Invalid request'});
            return;
        }
        const newGame = createGameFor(gameName, gameMinutes);

        gamesTable.insert(newGame);
        try {

            let dir = 'game_data';
            const tempDir = path.resolve(__dirname, dir)
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)
            fs.unlinkSync(path.resolve(dir, newGame.gameId.toString()));
        } catch (a) {
        }

        let renderedGamestate = renderGameState(newGame);
        renderedGamestate.transactionId = -1;
        renderedGamestate.ackTimestamp = new Date().getTime()
        recordGameDataTransaction(["gameState", renderedGamestate], newGame.gameId)

        res.status(200).send({gameId: newGame.gameId})
    } catch ( e) {
        console.log(e)
    }
});

app.use('/api/game', gamesRouter);

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
