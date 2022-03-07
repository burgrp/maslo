const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");


let pow2 = a => a * a;
let { sqrt, pow, hypot, abs, round, min, max, sign } = Math;

const MODE_STANDBY = "STANDBY";
const MODE_JOB = "JOB";

module.exports = async ({
    drivers,
    driver,
    config,
    checks
}) => {

    let model = {
        mode: MODE_STANDBY,
        sled: {
        },
        spindle: {
            on: false
        },
        motors: {},
        relays: {},
        errors: {}
    }

    let driverInstance = drivers[driver];
    await driverInstance.open();

    let motors = {};
    for (let name in config.motors) {
        let motorConfig = config.motors[name];
        if (!Number.isFinite(motorConfig.stepsPerMm)) {
            motorConfig.stepsPerMm = motorConfig.encoderPpr * motorConfig.gearRatio / motorConfig.mmPerRev;
        }
        motors[name] = await driverInstance.createMotor(name, motorConfig);
        model.motors[name] = {
            duty: 0
        };
    }

    let relays = {};
    for (let name in config.relays) {
        relays[name] = await driverInstance.createRelay(name, config.relays[name]);
        model.relays[name] = {
            on: false
        };
    }

    let waiters = [];


    async function checkModel() {

        async function checkMotorStates() {
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

        async function checkRelayStates() {
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

        function checkHooverRelay() {
            model.relays.hoover.on = model.relays.spindle.state && model.relays.spindle.state.on && model.spindle.zMm < 0 || false;
        }

        function checkJobSynchronizers() {
            while (waiters.length) {
                let waiter = waiters.shift();
                if (model.jobInterrupt) {
                    let e = new Error("Move interrupted");
                    e.moveInterrupted = true;
                    waiter.reject(e);
                } else {
                    waiter.resolve(model);
                }

            }
        }

        async function setMotorDuties() {
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

        async function setRelayStates() {
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

        await checkMotorStates();
        await checkRelayStates();
        await checkHooverRelay();
        await checkJobSynchronizers();
        await setMotorDuties();
        await setRelayStates();

        for (let check of checks) {
            await check(model);
        }
    }

    async function machineCheckLoop() {
        while (true) {
            let wait = new Promise(resolve => setTimeout(resolve, config.checkIntervalMs));
            try {
                await checkModel();
                delete model.errors.check;
            } catch (e) {
                logError("Error in machine check:", e);
                model.errors.check = e.message || e;
            }
            await wait;
        }
    }

    // fork the check loop
    machineCheckLoop().catch(e => {
        logError("Unhandled error in machine check loop:", e);
    });

    return {

        model,

        setMotorDuty(motor, duty) {
            model.motors[motor].duty = duty;
        },

        setRelayState(relay, on) {
            model.relays[relay].on = on;
        },

        setSledReference(xMm, yMm) {
            model.sled.reference = {
                xMm,
                yMm,
                aSteps: model.motors.a.state.steps,
                bSteps: model.motors.b.state.steps
            };
        },

        recalculateRatio(xMm, yMm) {
            if (!model.sled.reference) {
                throw new Error("No sled reference. Please calibrate top at first.");
            }
            for (let motor of ['a', 'b']) {

                let p1 = model.sled.reference;
                let p2 = {
                    xMm,
                    yMm,
                    aSteps: model.motors.a.state.steps,
                    bSteps: model.motors.b.state.steps
                }

                let calcLen = pos => hypot(config.beam.motorsDistanceMm / 2 - abs(pos.xMm), config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 - pos.yMm);

                let len1mm = calcLen(p1);
                let len2mm = calcLen(p2);

                if (abs(len2mm - len1mm) < 200) {
                    throw new Error("Calibration distances too small");
                }

                let steps1 = p1[motor + "Steps"];
                let steps2 = p2[motor + "Steps"];

                config.motors[motor].stepsPerMm = (steps1 - steps2) / (len1mm - len2mm);

                logInfo(`Motor ${motor} stepsPerMm set to ${config.motors[motor].stepsPerMm}`);
            }
        },

        setSpindleReference(zMm) {
            model.spindle.reference = {
                zMm: zMm,
                zSteps: model.motors.z.state.steps
            };
        },

        setTarget(target) {
            model.target = target;
        },

        synchronizeJob() {
            return new Promise((resolve, reject) => {
                waiters.push({ resolve, reject });
            });
        },

        interruptCurrentJob() {
            model.jobInterrupt = true;
        },

        async doJob(action) {

            if (model.mode !== MODE_STANDBY) {
                throw new Error("Machine not in standby mode");
            }

            model.mode = MODE_JOB;
            try {
                return await action();
            } catch (e) {
                if (!e.moveInterrupted) {
                    throw e;
                }
            } finally {
                model.mode = MODE_STANDBY;
                delete model.jobInterrupt;
                delete model.target;
            }
        }
    }
}