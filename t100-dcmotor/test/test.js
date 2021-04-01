const I2C = require("@burgrp/i2c");

function createMotor(i2c, address) {

    const COMMAND_SET_MOTOR = 1;
    const COMMAND_END_STEPS = 2;

    const STATE = ["IDLE", "RUNNING", "ERROR"];

    return {

        async setMotor(speed, direction) {
            let buffer = Buffer.alloc(3);
            buffer.writeUInt8(COMMAND_SET_MOTOR, 0);
            buffer.writeUInt8(Math.round(0xFF * speed), 1);
            buffer.writeUInt8(direction? 1: 0, 2);
            await i2c.i2cWrite(address, buffer);
        },

        async get() {
            let buffer = await i2c.i2cRead(address, 15);
            return {
                state: buffer
            }
        }

    }
}

function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function start() {

    const i2c = await I2C(process.env.I2C);
    try {

        i2c.onIRQ(() => {
            console.info("IRQ");
        });

        const motor = createMotor(i2c, 0x50);

        const maxSpeed = 30;

        for (let speed = 0; speed <= maxSpeed; speed++) {
            console.info(speed);
            await motor.setMotor(speed / 100, false);
            await wait(100);
            console.info(await motor.get());    
        }

        await wait(3000);

        for (let speed = maxSpeed; speed >= 0; speed--) {
            console.info(speed);
            await motor.setMotor(speed / 100, false);
            await wait(100);
            console.info(await motor.get());    
        }

        //await new Promise(r => setTimeout(r, 10000));
    } finally {
        await i2c.close();
    }

}

start().catch(e => console.error(e));