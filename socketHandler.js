import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/cluster-adapter';
import { setupWorker } from '@socket.io/sticky';

export default class {
    constructor(server) {
        this.io = new Server(server);
        this.io.adapter(createAdapter())
        setupWorker(this.io)
        this.init();
    }

    init() {
        this.io.on("connection", socket => {
            console.log("🔌 Socket connected")
            // Join rooms based on user's Chat Ids
            socket.handshake.query.chatList.split(",").map(id => socket.join(id))
            // Join user id room to communicate updates to client app
            const userId = socket.handshake.query.user;
            socket.join(userId);

            socket.on("messageSent", (messageData) => {
                this.io.to(messageData.chat).emit("messageSent", messageData.chat);
            })

            socket.on("joinRooms", (roomList) => {
                // join all listed rooms (ignores rooms that this socket has already joined)
                roomList.forEach(room => socket.join(room))
            })

            socket.on("appOpened", (user) => {
                this.io.to(user).emit("appOpened")
            })

            socket.on("notificationsUpdated", (user) => {
                this.io.to(user).emit("notificationsUpdated")
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

    /**
     * Send user an event and data
     * @param {String} id the user's id
     * @param {any} data the data to send
     * @param {String} event the event to emit
     */
    sendDataEvent(id, data, event) {
        this.io.to(id).emit(event, data)
    }
}