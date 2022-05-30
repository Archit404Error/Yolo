import cluster from "cluster";
import { setupPrimary } from "@socket.io/cluster-adapter";
import os from "os";
import { runYoloBackend } from "./server.js";
if (cluster.isPrimary) {
    setupPrimary();

    cluster.fork();

    cluster.on('online', worker => console.log(`🚨 Worker ${worker.process.pid} online`))
    cluster.on('exit', (worker, code, signal) => {
        console.log(`⛔️ Worker ${worker.process.pid} died`)
        console.log(`⛔️ Code: ${code}`)
        console.log(`⛔️ Signal: ${signal}`)
        console.log(`💪 Forking off a new worker`)
        cluster.fork()
    })
} else {
    runYoloBackend()
}