import { Server } from 'socket.io';

export default class {
    constructor(server) {
        this.io = new Server(server);
        this.init();
    }

    init() {
        this.io.on("connection", (socket) => {
            console.log("A user connected");
            socket.join(socket.handshake.query.chatId)
            console.log(`Joined room ${socket.handshake.query.chatId}`)
        })

        this.io.on("disconnect", (socket) => {
            console.log("User disconnected")
        })
    }
}