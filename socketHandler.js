import { Server } from 'socket.io';

export default class {
    constructor(server) {
        this.io = new Server(server);
        this.init();
    }

    init() {
        this.io.on("connection", (socket) => {
            // Join rooms based on user's Chat Ids
            socket.handshake.query.chatList.split(",").map(id => socket.join(id))
            // Join user id room to communicate updates to client app
            const userId = socket.handshake.query.user;
            socket.join(userId);

            socket.on("messageSent", (messageData) => {
                this.io.to(messageData.chat).emit("messageSent", messageData.chat);
            })

            socket.on("eventsUpdated", () => {
                console.log("Sending event updates")
                this.io.to(userId).emit("eventsUpdated");
            })

            socket.on("disconnect", () => {
                socket.disconnect();
            })
        })
    }

    /**
     * Send user a simple event notif
     * @param {String} id the user's id
     * @param {String} event the name of the event
     */
    sendUserEvent(id, event) {
        this.io.to(id).emit(event);
    }
}