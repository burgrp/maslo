const Debug = require("debug");
const I2C = require("@burgrp/i2c");

module.exports = async ({ bus, motorAddresses }) => {

    function createMotor(i2c, address) {

        const COMMAND_SET_SPEED = 1;
        const COMMAND_SET_END_STEPS = 2;

        return {

            async setSpeed(speed) {
                let buffer = Buffer.alloc(2);
                buffer.writeUInt8(COMMAND_SET_SPEED, 0);
                buffer.writeUInt8(speed, 1);
                await i2c.i2cWrite(address, buffer);
            },

            async setEndSteps(endSteps) {
                let buffer = Buffer.alloc(5);
                buffer.writeUInt8(COMMAND_SET_END_STEPS, 0);
                buffer.writeInt32LE(endSteps, 1);
                await i2c.i2cWrite(address, buffer);
            },

            async get() {

                let buffer = await i2c.i2cRead(address, 1 + 1 + 4 + 4 + 2);

                return {
                    speed: buffer.readUInt8(0),
                    running: !!(buffer.readUInt8(1) & 1),
                    endStops: [!!(buffer.readUInt8(1) >> 1 & 1), !!(buffer.readUInt8(1) >> 2 & 1)],
                    error: buffer.readUInt8(1) >> 5,
                    actSteps: buffer.readInt32LE(2),
                    endSteps: buffer.readInt32LE(6),
                    currentMA: buffer.readInt16LE(10)
                }
            }

        }
    }

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

        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            let driver = createMotor(i2c, motorAddresses[name]);

            let driverState;
            let machineState;

            let movePromise;

            async function updateState() {
                driverState = await driver.get();
                machineState = {
                    steps: driverState.actSteps,
                    lo: { stop: driverState.endStops[0] },
                    hi: { stop: driverState.endStops[1] },
                    running: { stop: driverState.running },
                    currentMA: { stop: driverState.currentMA }
                };

                listener();

                if (!driverState.running && movePromise) {
                    movePromise.resolve();
                }
            }

            await updateState(false);

            stateUpdates.push(updateState);

            return {
                name,

                getState() {
                    return machineState;
                },

                async move(steps, timeMs) {
                    log(`move ${steps} steps in ${timeMs} ms`);

                    await driver.setSpeed(40);
                    await updateState();
                    await driver.setEndSteps(driverState.actSteps + steps);

                    await new Promise((resolve, reject) => {
                        movePromise = { resolve, reject };
                    });
                    movePromise = undefined;
                },

                async stop() {
                    await driver.setSpeed(0);
                    await updateState();
                    await driver.setEndSteps(driverState.actSteps);
                }
            }
        },

        async createRelay(name, listener) {
            let log = Debug(`app:relay:${name}`);

            return {
                name,
                getState() {
                    return false;
                },
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);

                }
            }
        }

    }

}