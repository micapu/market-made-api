#!/usr/bin/env node

/**
 * Module dependencies.
 */
var express = require('express');
const fs = require('fs');

var app = express();

var debug = require('debug')('marketmadeapi:server');
var http = require('http');
var winston = require('winston')
const logLevel = 'debug';

const accessLog = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    defaultMeta: {service: 'access'},
    transports: [
        new winston.transports.File({filename: 'error.log', level: 'error'}),
        new winston.transports.File({filename: 'access.log'}),
    ],
});

/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(process.env.PORT || '3001');
app.set('port', port);

/**
 * Create HTTP server.
 */

var server = http.createServer(app);

const {Server} = require("socket.io")

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
    if (order1.isBid === order2.isBid) {
        return false;
    }

    const lowerPrice = order1.price >= order2.price ? order2 : order1;
    const higherPrice = order1.price < order2.price ? order2 : order1;

    return !lowerPrice.isBid || lowerPrice.price === higherPrice.price;
}

// I just changed this but idk what I did come back here
function createTick(order1, order2, transactedVolume, bidWasAggressor, tickId) {
    const bid = order1.isBid ? order1 : order2
    const ask = !order1.isBid ? order1 : order2
    return {
        price: order2.price,
        volume: transactedVolume,
        buyer: bid.name,
        bidWasAggressor,
        seller: ask.name,
        timestamp: new Date().getTime(),
        tickId
    }
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

function sendError(socket, message, errorDetails) {
    console.log("Error sent: ", message, errorDetails)
    socket.emit('erroneousAction', {message: message || "No message", errorDetails});
}

function recordGameDataTransaction(transaction, gameId) {
    fs.appendFile(`game_data/${gameId}`, JSON.stringify(transaction) + "\n", function (err) {
        if (err) throw err;
    });
}

function emitToMarket(socket, gameState, event, object) {
    object.transactionId = gameState.transactionSequence++
    object.ackTimestamp = new Date().getTime()
    recordGameDataTransaction([event, object], gameState.gameId)
    socket.to(gameState.gameId).emit(event, object)
    socket.emit(event, object)
}

function makePlayerData(name) {
    // todo some of these names are mislaeding, especially the "position ones"
    return {
        name,
        longPosition: 0,
        shortPosition: 0,
        totalOutstandingLongVolume: 0,
        totalOutstandingShortVolume: 0,
        scrapeValue: 0,
        totalLongVolume: 0,
        totalShortVolume: 0,
        outstandingBids: {},
        outstandingAsks: {},
    };
}

// (function() {
function getScrapedValue({totalLongVolume, totalShortVolume, longPosition, shortPosition}, userLogger) {

    const averageBuy = longPosition / totalLongVolume
    const averageAsk = shortPosition / totalShortVolume
    return Math.min(totalShortVolume, totalLongVolume) * (averageAsk - averageBuy)

    /*
    let minVol;
    let minVolPosition;
    let iterOrders;
    if (totalLongVolume > totalShortVolume) {
        minVol = totalShortVolume;
        minVolPosition = shortPosition;
        iterOrders = bidTicks;
    } else {
        minVol = totalLongVolume;
        minVolPosition = longPosition;
        iterOrders = askTicks;
    }

    let totalIterVolume = 0;
    let totalIterPosition = 0;
    let i = 0;
    console.log({minVol, minVolPosition, iterOrders, totalLongVolume, totalShortVolume, longPosition, shortPosition, bidTicks, askTicks});
    userLogger.info({minVol, minVolPosition, iterOrders, totalLongVolume, totalShortVolume, longPosition, shortPosition, bidTicks, askTicks})
// {"level":"info","message":{"askTicks":[{"price":1,"volume":1}],
// bidTicks":[{"price":2,"volume":1}],
// "iterOrders":[{"price":1,"volume":1}]
// "longPosition":2,"minVol":1,
// "minVolPosition":2,"shortPosition":1,
// "totalLongVolume":1,"totalShortVolume":1},"service":"access","timestamp":"2021-12-24T17:53:20.456Z"}
    while (totalIterVolume < minVol && i < iterOrders.length) {
        let {price:iterPrice, volume:iterVol} = iterOrders[i++];
        const volLeft = Math.min(iterVol, minVol - totalIterVolume);
        userLogger.info({volLeft, totalIterVolume, iterVol, iterPrice, a:[iterVol, minVol - totalIterVolume]})
        totalIterVolume += volLeft;
        totalIterPosition += (iterVol * iterVol * iterPrice) / volLeft
    }
    userLogger.info({totalIterPosition, minVolPosition})
    return (totalIterPosition - minVolPosition)*/
}

// console.log(getScrapedValue({bidTicks:[{price:1,volume:1}], askTicks:[{price:4,volume:1}, {price:2,volume: 1}], totalLongVolume:1, totalShortVolume:1, longPosition:1, shortPosition:2},{info:console.log}))
// })()

function renderGameView(gameState) {
    const {
        gameMinutes,
        gameName,
        parties,
        expiryTimestamp,
        tickDecimals,
        finalPlayerData,
        finalTicks,
        unitPrefix,
        unitSuffix,
        tickSize,
        gameExposure
    } = gameState
    let marketValue = gameState.finalPlayerData ? {marketValue: gameState.marketValue} : {}
    return {
        gameMinutes,
        gameName,
        parties,
        expiryTimestamp,
        tickDecimals,
        finalPlayerData,
        unitPrefix,
        unitSuffix,
        tickSize,
        gameExposure,
        finalTicks, ...marketValue
    };
}

function countDecimals(value) {
    if (Math.floor(value) !== value)
        return value.toString().split(".")[1].length || 0;
    return 0;
}

const positionLimits = 20;

function coerceToPrice(number, tickSize, tickDecimals) {
    const closestMatch = Math.round(number / tickSize) * tickSize
    if (Math.abs((closestMatch - number) / tickSize) >= 0.1) {
        return undefined;
    }
    return Number(closestMatch.toFixed(tickDecimals));
}

function makeFinalPlayerData(gameState) {
    const finalPlayerData = {}

    Object.values(gameState.playerData).forEach(({
                                                     name,
                                                     longPosition,
                                                     shortPosition,
                                                     totalLongVolume,
                                                     totalShortVolume
                                                 }) => {
        finalPlayerData[name] = {name, longPosition, shortPosition, totalLongVolume, totalShortVolume}
    })
    return finalPlayerData;
}

gameNameSpace.on('connection', (socket) => {
    socket.persistedContext = {}
    //    const registerEventHandler = (event, validators:[[(Socket, ContextData:any)=>Boolean, ErrorMessage:String]], listener:(data:any, contextData:any)=>{}) => {
    const registerEventHandler = (event, validators, listener) => {
        socket.on(event, (requestData) => {
            console.log({event, requestData})
            accessLog.info({requestData})
            const contextData = new Proxy({
                sendInfo(message) {
                    console.log("sent info", message)
                    socket.emit("info", {message})
                },
                persistContextVariable(prop, arg) {
                    socket.persistedContext[prop] = arg
                    this[prop] = arg;
                },
            }, {
                get: function (target, prop, receiver) {
                    if (!target.hasOwnProperty(prop)) {
                        return socket.persistedContext[prop];
                    }
                    return Reflect.get(...arguments);
                }
            })
            for (let i in validators) {
                const [validator, errorMessage] = validators[i];
                let result = validator(requestData, contextData);
                if (result !== true) {
                    if (contextData.userLogger)
                        contextData.userLogger.error({
                            requestData,
                            errorMessage,
                            gameState: contextData.gameState,
                            userData: contextData.userData
                        });
                    sendError(socket, errorMessage, result);
                    return;
                }
            }
            if (contextData.gameLogger) {
                contextData.gameLogger.info({requestData, event, socketId: socket.id})
            }
            if (contextData.userLogger && contextData.gameState) {
                contextData.userLogger.info({requestData})
                contextData.userLogger.debug({contextData})
            }

            listener(requestData, contextData);

            if (contextData.userLogger && contextData.gameState) {
                contextData.userLogger.debug({finalGameState: contextData.gameState})
            }
            Object.assign(socket.persistedContext, contextData.persistedContext)
        })
    }

    const gameRetriever = [(data, contextData) => {
        if (contextData.gameState) {
            return true;
        }
        if (!data) {
            socket.disconnect()
            return {message: "Data Undefined"};
        }
        const gameId = Number(data.gameId);
        const gameState = gamesTable.findOne({gameId});
        if (!gameState) {
            return false;
        }
        contextData.persistContextVariable("gameState", gameState)
        const gameLogger = winston.createLogger({
            level: logLevel,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            defaultMeta: {service: 'access'},
            transports: [
                new winston.transports.File({filename: `logs/game/${gameState.gameId}/game.log`}),
            ],
        })
        contextData.persistContextVariable("gameLogger", gameLogger)
        socket.dangerousGameLogger = gameLogger
        return true;
    }, "Cannot join game that does not exist"]

    const marketParticipantAuthenticator = [(_, contextData) => {
        if (contextData.playerData) {
            return true;
        }
        const playerData = contextData.gameState.playerData[socket.authenticatedName]
        if (!playerData) {
            return false;
        }

        contextData.persistContextVariable("userLogger", winston.createLogger({
            level: logLevel,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            defaultMeta: {service: 'access'},
            transports: [
                new winston.transports.File({filename: `logs/game/${contextData.gameState.gameId}/user_${socket.authenticatedName}.log`}),
            ],
        }))
        contextData.persistContextVariable("playerData", playerData);
        return true;
    }, "You are not an authenticated member of this market"]

    const dangerousGetTickSize = () => socket.persistedContext.gameState.tickSize || "error retrieving tick size"

    const validPriceAuthenticator = [({unsanitizedPrice}, contextData) => {
        const price = coerceToPrice(Number(unsanitizedPrice), contextData.gameState.tickSize, contextData.gameState.tickDecimals)
        if (price === undefined || price < 0 || isNaN(price)) {
            return {tickSize: dangerousGetTickSize()};
        }
        contextData.coercedPrice = price
        return true;
    }, "Invalid price, not a multiple of the tick size"]

    const getGameExpiryValidator = (alwaysAllow = false) => [(_, {gameState}) => {
        let expired = gameState.expiryTimestamp < new Date().getTime();
        if (!expired) {
            return true;
        }
        if (!gameState.finalPlayerData) {
            gameState.finalPlayerData = makeFinalPlayerData(gameState);
            gameState.finalTicks = [...gameState.orderInfo.ticks]
        }
        return alwaysAllow;
    }, "Game has expired"]

    const validVolumeAuthenticator = [({unsanitizedVolume}, contextData) => {
        const volume = Number(unsanitizedVolume)
        if (volume < 0 || isNaN(volume)) {
            return false;
        }
        contextData.volume = volume
        return true;
    }, "Invalid volume"]

    const validIsBid = [({isBid}) => (typeof isBid == 'boolean'), "Invalid is-bid"]

    const registerMarketParticipantHandler = (event, extraValidators, listener) => {
        registerEventHandler(event, [gameRetriever, getGameExpiryValidator(), marketParticipantAuthenticator, ...extraValidators], listener)
    }

    registerEventHandler('viewGame', [gameRetriever, getGameExpiryValidator(true)], (data, contextData) => {
        socket.emit('gameView', renderGameView(contextData.gameState));
    })

    registerEventHandler('joinGame', [gameRetriever, getGameExpiryValidator()], ({name}, {gameState}) => {
        socket.join(gameState.gameId)
        socket.gameId = gameState.gameId;
        socket.authenticatedName = name;
        let renderedGameState = renderGameState(gameState);
        if (gameState.parties.indexOf(name) !== -1) {
            const playerData = gameState.playerData[name]
            socket.emit("youJoined", playerData)
            socket.emit("gameState", renderedGameState)
            return;
        }
        gameState.parties.push(name);
        const playerData = makePlayerData(name)
        gameState.playerData[name] = playerData
        emitToMarket(socket, gameState, "gameJoin", {name});
        socket.emit("youJoined", playerData)
        renderedGameState = renderGameState(gameState);
        socket.emit('gameState', renderedGameState);
        emitToMarket(socket, gameState, "playerDataUpdate", playerData)
    })


    registerMarketParticipantHandler('pullOrders', [], (data, {gameState, playerData}) => {
        Object.values(playerData.outstandingBids)
            .concat(Object.values(playerData.outstandingAsks))
            .forEach(order => cancelOrder({gameState, playerData}, order))
    })

    const playerCanInsertVolumeAuthenticator = [({isBid}, {playerData, volume, userLogger}) => {
        if (!isBid) {
            volume = -volume
        }
        let netPosition = playerData.totalLongVolume - playerData.totalShortVolume;
        const netPositionIfAllOutstandingBought = netPosition + playerData.totalOutstandingLongVolume
        const netPositionIfAllOutstandingSold = netPosition - playerData.totalOutstandingShortVolume
        return netPositionIfAllOutstandingBought + volume <= positionLimits && netPositionIfAllOutstandingSold + volume >= (-positionLimits);
    }, "Player cannot insert this volume."]

    const validOrderAuthenticator = [({orderId}, contextData) => {
        const {ordersById} = contextData.gameState.orderInfo
        const order = ordersById[orderId]
        if (order === undefined) {
            return false;
        }
        contextData.order = order;
        return true;
    }, "Invalid order"]

    registerMarketParticipantHandler(
        'insertOrder',
        [validPriceAuthenticator, validVolumeAuthenticator, validIsBid, playerCanInsertVolumeAuthenticator],
        ({isBid, orderType}, {gameState, playerData, gameLogger, userLogger, coercedPrice, volume, sendInfo}) => {
            const {orderInfo, gameId} = gameState;
            const orderId = orderInfo.orderIdSequence++;
            // todo remove
            console.assert(typeof coercedPrice == "number")
            const outstandingOrder = {
                price: coercedPrice, volume, isBid, originalVolume: volume,
                orderId, name: socket.authenticatedName
            };

            const {bids, asks, ordersById} = orderInfo

            const ticks = orderInfo.ticks

            //makeTransactions(outstandingOrder, !isBid ? asks : bids , isBid ? asks : bids, ticks, ordersById)

            let {volume: outstandingVolume} = outstandingOrder;
            const orderInsertList = !isBid ? asks : bids;
            const orders = isBid ? asks : bids;
            let updates = []
            let flushUpdates = () => {
                updates.forEach(([event, update]) => {
                    emitToMarket(socket, gameState, event, update)
                })
                updates = []
            };
            userLogger.debug({outstandingOrder})
            userLogger.debug({orders});

            while (outstandingVolume > 0 && orders.length > 0 && isTransaction(outstandingOrder, orders[0])) {
                if (orderType === "dime") {
                    sendInfo("Dime would transact, cancelled")
                    return;
                }
                const aggressiveStandingOrder = orders[0]
                if (aggressiveStandingOrder.name === socket.authenticatedName) {
                    flushUpdates();
                    sendError(socket, "Self trade");
                    return;
                }

                const transactedVolume = Math.min(aggressiveStandingOrder.volume, outstandingVolume)
                aggressiveStandingOrder.volume -= transactedVolume
                outstandingVolume -= transactedVolume;
                const tickId = orderInfo.tickIdSequence++;
                const tick = createTick(outstandingOrder, aggressiveStandingOrder, transactedVolume, outstandingOrder.isBid, tickId)

                ticks.push(tick);
                updates.push(['onTick', tick])

                const {buyer, seller, price, volume} = tick;
                let buyerData = gameState.playerData[buyer];
                let sellerData = gameState.playerData[seller];
                let priceVol = price * volume;

                buyerData.longPosition += priceVol
                sellerData.shortPosition += priceVol
                buyerData.totalLongVolume += volume
                sellerData.totalShortVolume += volume
                buyerData.totalOutstandingLongVolume -= volume
                sellerData.totalOutstandingShortVolume -= volume

                buyerData.scrapeValue = getScrapedValue(buyerData, userLogger)
                sellerData.scrapeValue = getScrapedValue(sellerData, userLogger)
                updates.push(['playerDataUpdate', buyerData])
                updates.push(['playerDataUpdate', sellerData])

                if (aggressiveStandingOrder.volume <= 0) {
                    orders.shift();
                }

                // clients should handle volume 0 as removal
                updates.push(['orderUpdate', aggressiveStandingOrder]);
                if (aggressiveStandingOrder.volume === 0) {
                    // todo come back here hope this works
                    // not only did I not come back here but this did not work
                    userLogger.info({
                        message: "aggressive standing order was deleted",
                        ordersById,
                        aggressiveStandingOrder
                    })
                    delete ordersById[aggressiveStandingOrder.orderId];
                    userLogger.info({message: "aggressive standing orders became", ordersById})
                } else userLogger.info({message: "aggressive standing order was not deleted", aggressiveStandingOrder});
            }

            // todo refactor? Probably the only place bids will come from though. Much of this function needs modularising :disappointed:

            if (outstandingVolume > 0) {
                if (orderType === "ioc") {
                    sendInfo(`IOC filled ${volume - outstandingVolume} out of ${volume}`)
                    flushUpdates();
                    return;
                }

                outstandingOrder.volume = outstandingVolume
                let insertIndex = sortedIndex(orderInsertList, outstandingOrder, (isBid ? ({price}) => -price : ({price}) => price));
                if (insertIndex > 0 && orderType === "dime") {
                    sendInfo("Someone else is top since that dime, cancelled.")
                    flushUpdates();
                    return;
                }
                const preElem = orderInsertList[insertIndex - 1]

                if (preElem && preElem.name === socket.authenticatedName && preElem.price === outstandingOrder.price) {
                    preElem.volume += outstandingOrder.volume
                    preElem.originalVolume += outstandingOrder.volume
                    updates.push(['orderUpdate', preElem])
                } else {
                    updates.push(['orderInsert', outstandingOrder])
                    orderInsertList.splice(insertIndex, 0, outstandingOrder)
                    ordersById[outstandingOrder.orderId] = outstandingOrder;
                    (isBid ? playerData.outstandingBids : playerData.outstandingAsks)[outstandingOrder.orderId] = outstandingOrder
                }
                if (isBid) {
                    playerData.totalOutstandingLongVolume += outstandingVolume
                } else {
                    playerData.totalOutstandingShortVolume += outstandingVolume
                }
            }

            flushUpdates();
        })

    function cancelOrder(contextData, order) {
        const {gameState, playerData} = contextData
        const id = order.orderId;
        socket.dangerousGameLogger.info({action: "cancelOrder", order})
        if (order.isBid) {
            playerData.totalOutstandingLongVolume -= order.volume
        } else {
            playerData.totalOutstandingShortVolume -= order.volume
        }

        order.volume = 0;

        const {bids, asks} = gameState.orderInfo
        const orderList = order.isBid ? bids : asks;
        delete (order.isBid ? playerData.outstandingBids : playerData.outstandingAsks)[order.orderId]

        const index = orderList.indexOf(order);
        /*
        where you were, place as 1 then 2 then 1 then cancel right to left
        todo
         */
        if (index > -1) {
            orderList.splice(index, 1);
        }

        emitToMarket(socket, gameState, 'orderUpdate', order)
    }

    registerMarketParticipantHandler('cancelOrder', [validOrderAuthenticator], ({orderId}, {
        gameState,
        playerData,
        order
    }) => {
        if (order.name !== socket.authenticatedName) {
            sendError(socket, "order is not yours!" + socket.authenticatedName + order + id)
            return;
        }

        cancelOrder({gameState, playerData}, order);
    })

});

const gamesRouter = express.Router();

const db: Loki = new loki('Example');


let gameIndex = 0;
const gamesTable = db.addCollection('games', {indices: ['gameId', 'expiryTimestamp']});
const ordersTable = db.addCollection('orders', {indices: ['gameId', 'orderId']});
const ticksTable = db.addCollection('ticks', {indices: ['gameId', 'buyer', 'seller']});

const gameOrders = {}
const gameTicks = {}


app.use(cors());
// view engine setup
app.set('views', path.join(__dirname, 'views'));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function createGameFor(gameName, gameMinutes, marketValue, unitPrefix, unitSuffix, tickSize, gameExposure) {
    let gameId = gameIndex++;
    // dynamic views aren't handled in a particularly clever way, each view being added is another lookup per update on the dataset
    const orderInfo = {
        bids: [],
        asks: [],
        ticks: [],
        orderIdSequence: 0,
        tickIdSequence: 0,
        ordersById: {}
    }

    const expiryTimestamp = new Date(new Date().getTime() + gameMinutes * 60000).getTime();
    return {
        gameName,
        gameMinutes: Number(gameMinutes),
        gameId,
        expiryTimestamp,
        parties: [],
        marketValue,
        orderInfo,
        playerData: {},
        transactionSequence: 0,
        unitPrefix, unitSuffix, tickSize,
        gameExposure,
        tickDecimals: countDecimals(tickSize)
    };
}


function renderGameState(gameState) {
    const {
        gameName,
        gameMinutes,
        gameId,
        parties,
        orderInfo,
        playerData,
        expiryTimestamp,
        tickDecimals,
        unitPrefix,
        unitSuffix,
        tickSize,
        gameExposure
    } = gameState
    // todo maybe dont copy playerdata
    return {
        gameName,
        gameMinutes,
        gameId,
        parties,
        playerData: {...playerData},
        unitPrefix,
        unitSuffix,
        tickSize,
        gameExposure,
        bids: orderInfo.bids,
        asks: orderInfo.asks,
        ticks: orderInfo.ticks,
        expiryTimestamp,
        tickDecimals,
    };
}


gamesRouter.post('/', function (req, res) {
    console.log("game created", req.body);
    try {
        const {gameName, gameMinutes, marketValue, unitPrefix, unitSuffix, tickSize, gameExposure} = req.body;
        if (!(gameName && gameMinutes && marketValue && tickSize && gameExposure)) {
            res.status(400).send({errorMessage: 'All fields are required'});
            return;
        }
        if (isNaN(Number(gameMinutes)) || gameMinutes <= 0) {
            res.status(400).send({errorMessage: 'Minutes not valid'});
            return;
        }
        if (isNaN(Number(tickSize)) || tickSize <= 0) {
            res.status(400).send({errorMessage: 'Tick-size not valid'});
            return;
        }
        if (isNaN(Number(marketValue))) {
            res.status(400).send({errorMessage: 'Market Value not valid'});
            return;
        }
        if (isNaN(Number(gameExposure)) || gameExposure <= 0) {
            res.status(400).send({errorMessage: 'Exposure is not valid'});
            return;
        }


        const newGame = createGameFor(gameName, gameMinutes, marketValue, unitPrefix, unitSuffix, Number(tickSize), gameExposure);

        console.log("inserted ", newGame);
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
        recordGameDataTransaction(["gameView", renderGameView(newGame)], newGame.gameId)
        recordGameDataTransaction(["gameState", renderedGamestate], newGame.gameId)

        res.status(200).send({gameId: newGame.gameId})
    } catch (e) {
        console.log(e)
    }
});

app.use('/api/game', gamesRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;
