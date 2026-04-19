"use strict";
// Tipos compartidos entre cliente y servidor
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketEvents = void 0;
// Eventos de Socket.io
var SocketEvents;
(function (SocketEvents) {
    SocketEvents["CONNECT"] = "connect";
    SocketEvents["DISCONNECT"] = "disconnect";
    SocketEvents["PLAYER_JOIN"] = "player:join";
    SocketEvents["PLAYER_LEAVE"] = "player:leave";
    SocketEvents["PLAYER_MOVE"] = "player:move";
    SocketEvents["PLAYER_ATTACK"] = "player:attack";
    SocketEvents["GAME_STATE"] = "game:state";
    SocketEvents["WAVE_START"] = "wave:start";
    SocketEvents["WAVE_END"] = "wave:end";
})(SocketEvents || (exports.SocketEvents = SocketEvents = {}));
