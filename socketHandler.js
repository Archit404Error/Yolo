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
            socket.on("messageSent", (messageData) => {
                console.log(`${messageData.sender} : ${messageData.message}`)
                this.io.to(messageData.chat).emit("messageSent");
            })
            socket.on("disconnect", () => {
                console.log("User disconnected")
                socket.disconnect();
            })
        })
    }
}