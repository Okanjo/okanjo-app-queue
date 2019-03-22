"use strict";

const amqplib = require('amqplib/callback_api');

exports.getMessage = function getMessage(connection, queue) {
    return new Promise((resolve, reject) => {
        connection.createChannel((err, channel) => {
            if (err) return reject(err);
            channel.get(queue, { noAck: true }, (err, message) => {
                if (err) return reject(err);
                return resolve(message);
            });
        });
    });
};

exports.getConnection = function getConnection() {
    return new Promise((resolve, reject) => {
        amqplib.connect(function(err, connection) {
            if (err) return reject(err);
            resolve(connection);
        });
    });
};