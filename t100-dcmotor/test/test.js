const I2C = require("@burgrp/i2c");

function createMotor(i2c, address) {

    const COMMAND_SET_SPEED = 1;
    const COMMAND_SET_END_STEPS = 2;

    return {

        async setSpeed(speed) {
            let buffer = Buffer.alloc(2);
            buffer.writeUInt8(COMMAND_SET_SPEED, 0);
            buffer.writeUInt8(Math.round(0xFF * speed), 1);
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
                currentmA: buffer.readInt16LE(10)
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
        i2c.nop();

        let motors = ["L"].map((name, i) => {
            let motor = createMotor(i2c, 0x50 + i);
            motor.name = name;
            return motor;
        });

        for (let motor of motors) {
            await motor.setSpeed(0);
            let state = await motor.get();
            console.info(motor.name, state);
            await motor.setEndSteps(state.actSteps + 1000);
        }

        for (let motor of motors) {
            await motor.setSpeed(0.4);
        }

        while (true) {
            for (let motor of motors) {
                console.info(motor.name, await motor.get());
            }
            await wait(100);
        }        


        // const motor = createMotor(i2c, 0x52);

        // const maxSpeed = 100;

        // let state = await motor.get();
        // console.info(state);

        // await motor.setSpeed(0);
        // await motor.setEndSteps(state.actSteps + 10000);


        // for (let speed = 0; speed <= maxSpeed; speed++) {
        //     console.info(speed);
        //     await motor.setSpeed(speed / 100);
        //     await wait(1);
        //     console.info(await motor.get());
        // }

        // while (true) {
        //     console.info(await motor.get());
        //     await wait(1000);
        // }

        // for (let speed = 0; speed <= maxSpeed; speed++) {
        //     console.info(speed);
        //     await motor.setSpeed(speed / 100);
        //     await wait(100);
        //     console.info(await motor.get());
        // }

        // await wait(3000);

        // for (let speed = maxSpeed; speed >= 0; speed--) {
        //     console.info(speed);
        //     await motor.setSpeed(speed / 100);
        //     await wait(100);
        //     console.info(await motor.get());
        // }

    } finally {
        await i2c.close();
    }

}

start().catch(e => console.error(e));