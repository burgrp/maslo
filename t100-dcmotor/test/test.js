const I2C = require("@burgrp/i2c");

const createMotor = require("./t100-dcmotor.js");

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

        let motors = Object.entries({
            "a": 0x50,
            "b": 0x51,
            "z": 0x52
        }).map(([name, address]) => {
            let motor = createMotor({ i2c, address });
            motor.name = name;
            return motor;
        });

        for (let motor of motors) {
            await motor.set(0);
            let state = await motor.get();
            console.info(motor.name, state);
        }

        for (let motor of motors) {
            await motor.set(0.3);
            let state = await motor.get();
            console.info(motor.name, state);
        }

        await wait(3000);

        for (let motor of motors) {
            await motor.set(0);
            let state = await motor.get();
            console.info(motor.name, state);
        }  

    } finally {
        await i2c.close();
    }

}

start().catch(e => console.error(e));