const Debug = require("debug");
const I2C = require("@burgrp/i2c");
const createMotor = require("../../t100-dcmotor/test/t100-dcmotor.js");

module.exports = async ({ bus, motorAddresses }) => {

    let i2c;
    let stateUpdates = [];

    return {

        async open() {
            i2c = await I2C(bus);
            i2c.nop();
            i2c.onIRQ(async () => {
                for (let stateUpdate of stateUpdates) {
                    await stateUpdate();
                }
            });

            async function scheduleNextUpdate() {
                try {
                    for (let stateUpdate of stateUpdates) {
                        await stateUpdate();
                    }
                } catch (e) {
                    console.error("Error in periodic update:", e);
                }
                setTimeout(scheduleNextUpdate, 100);
            }

            scheduleNextUpdate();
        },

        createMotor(name) {
            return createMotor({ i2c, address: motorAddresses[name] });
        },

        async createRelay(name) {
            let log = Debug(`app:relay:${name}`);

            let state = {
                on: false
            };

            return {
                name,
                state,

                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    state.on = newOn;
                }
            }
        }


    }

}