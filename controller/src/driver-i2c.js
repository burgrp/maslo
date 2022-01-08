const Debug = require("debug");
const logError = require("debug")("app:i2c:error");
const I2C = require("@burgrp/i2c");
const createMotor = require("../../t100-dcmotor/test/t100-dcmotor.js");

module.exports = async ({ bus, motors }) => {

    let i2c;

    return {

        async open() {
            i2c = await I2C(bus);
            try {
                await i2c.setReset(false);
                await i2c.setReset(true);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch(e) {
                logError("Could not reset devices on I2C bus:", e);
            }
        },

        createMotor(name, config) {
            return createMotor({ i2c, ...config.i2c });
        },

        async createRelay(name) {

            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                async get() {
                    return { on };
                },

                async set(newOn) {
                    on = newOn;
                    //log(`switch ${on ? "on" : "off"}`);
                }
            }

        }


    }

}