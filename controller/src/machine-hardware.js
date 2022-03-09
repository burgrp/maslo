const logError = require("debug")("app:machine:error");

module.exports = async ({
    config,
    drivers,
    driver    
}) => {


    let driverInstance = drivers[driver];
    await driverInstance.open();

    let motors = {};
    for (let name in config.motors) {
        let motorConfig = config.motors[name];
        if (!Number.isFinite(motorConfig.stepsPerMm)) {
            motorConfig.stepsPerMm = motorConfig.encoderPpr * motorConfig.gearRatio / motorConfig.mmPerRev;
        }
        motors[name] = await driverInstance.createMotor(name, motorConfig);
    }

    let relays = {};
    for (let name in config.relays) {
        relays[name] = await driverInstance.createRelay(name, config.relays[name]);
    }

    async function checkMotorStates(model) {
        for (let name in motors) {
            const m = model.motors[name];
            try {
                m.state = await motors[name].get();
                delete model.errors[`motor.${name}.get`];
            } catch (e) {
                logError(`Motor ${name} error on get:`, e);
                delete m.state;
                model.errors[`motor.${name}.get`] = e.message || e;
            }
        }
    }

    async function checkRelayStates(model) {
        for (let name in relays) {
            const r = model.relays[name];
            try {
                r.state = await relays[name].get();
                delete model.errors[`relay.${name}.get`];
            } catch (e) {
                logError(`Relay ${name} error on get:`, e);
                delete r.state;
                model.errors[`relay.${name}.get`] = e.message || e;
            }
        }
    }

    function checkHooverRelay(model) {
        model.relays.hoover.on = model.relays.spindle.state && model.relays.spindle.state.on && model.spindle.zMm < 0 || false;
    }

    async function setMotorDuties(model) {
        for (let name in motors) {
            const m = model.motors[name];
            try {
                await motors[name].set(m.duty);
                delete model.errors[`motor.${name}.set`];
            } catch (e) {
                logError(`Motor ${name} error on set:`, e);
                model.errors[`motor.${name}.set`] = e.message || e;
            }
        }
    }

    async function setRelayStates(model) {
        for (let name in relays) {
            const r = model.relays[name];
            try {
                await relays[name].set(r.on);
                delete model.errors[`relay.${name}.set`];
            } catch (e) {
                logError(`Relay ${name} error on set:`, e);
                model.errors[`relay.${name}.set`] = e.message || e;
            }
        }
    }

    return {

        async initializeModel(model) {
            
            model.motors = Object.keys(motors).reduce((acc, k)=>({...acc, [k]: {
                duty: 0
            }}), {});
            ;
            model.relays = Object.keys(relays).reduce((acc, k)=>({...acc, [k]: {
                on: false
            }}), {});
        },

        async readHardware(model) {
            await checkMotorStates(model);
            await checkRelayStates(model);
            await checkHooverRelay(model);
        },

        async writeHardware(model) {
            await setMotorDuties(model);
            await setRelayStates(model);
        }

    };
}