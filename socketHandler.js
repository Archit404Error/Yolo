import { Server } from 'socket.io';

export default class {
    constructor(server) {
        this.io = new Server(server);
        this.init();
    }

    init() {
        this.io.on("connection", (socket) => {
            console.log("A user connected");
            socket.join(socket.request._query['chatId'])
            console.log(`Joined room ${socket.request._query['chatId']}`)
        })

        this.io.on("disconnect", (socket) => {
            console.log("User disconnected")
        })
    }
}