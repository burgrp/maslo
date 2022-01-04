const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");
const objectHash = require("object-hash");


function distanceMmToAbsSteps(motorConfig, distanceMm) {
    let stretch = motorConfig.stretch || 1;
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.mmPerRev * stretch);
}

function absStepsToDistanceMm(motorConfig, steps) {
    let stretch = motorConfig.stretch || 1;
    return steps * motorConfig.mmPerRev * stretch / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

let pow2 = a => a * a;
let { sqrt, pow, hypot, abs, round, min, max, sign } = Math;

const MODE_STANDBY = "STANDBY";
const MODE_JOB = "JOB";

module.exports = async ({
    drivers,
    driver,
    geometry,
    config
}) => {

    let state = {
        mode: MODE_STANDBY,
        sled: {
        },
        spindle: {
            on: false
        },
        userOrigin: {
            xMm: 0,
            yMm: 0
        },
        motors: {},
        relays: {},
        errors: {}
    }

    let driverInstance = drivers[driver];
    await driverInstance.open();

    let motors = {};
    for (let name in config.motors) {
        motors[name] = await driverInstance.createMotor(name, config.motors[name]);
        state.motors[name] = {
            duty: 0
        };
    }

    let relays = {};
    for (let name in config.relays) {
        relays[name] = await driverInstance.createRelay(name, config.relays[name]);
        state.relays[name] = {
            on: false
        };
    }

    let stateHash;
    let stateChangedListeners = [];
    let stateChangedListenersPending = false;
    let waiters = [];

    function userToMachineCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 - pos.yMm
        }
    }

    function machineToUserCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 - pos.yMm
        }
    }

    function getChainLengths(positionUCS) {
        let positionMCS = userToMachineCS(positionUCS);
        return {
            aMm: hypot(config.beam.motorsDistanceMm / 2 + positionMCS.xMm, positionMCS.yMm),
            bMm: hypot(config.beam.motorsDistanceMm / 2 - positionMCS.xMm, positionMCS.yMm)
        };
    }

    async function checkMachineState() {

        async function checkMotorStates() {
            for (let name in motors) {
                const m = state.motors[name];
                try {
                    m.state = await motors[name].get();
                    delete state.errors[`motor.${name}.get`];
                } catch (e) {
                    logError(`Motor ${name} error on get:`, e);
                    delete m.state;
                    state.errors[`motor.${name}.get`] = e.message || e;
                }
            }
        }

        async function checkRelayStates() {
            for (let name in relays) {
                const r = state.relays[name];
                try {
                    r.state = await relays[name].get();
                    delete state.errors[`relay.${name}.get`];
                } catch (e) {
                    logError(`Relay ${name} error on get:`, e);
                    delete r.state;
                    state.errors[`relay.${name}.get`] = e.message || e;
                }
            }
        }

        function checkSledPosition() {
            if (state.motors.a.state && state.motors.b.state) {

                if (
                    !Number.isFinite(state.sled.xMm) &&
                    !Number.isFinite(state.sled.yMm) &&
                    Number.isFinite(config.lastPosition.xMm) &&
                    Number.isFinite(config.lastPosition.yMm)
                ) {
                    state.sled.reference = {
                        xMm: config.lastPosition.xMm,
                        yMm: config.lastPosition.yMm,
                        aSteps: state.motors.a.state.steps,
                        bSteps: state.motors.b.state.steps
                    };
                }

                if (state.sled.reference) {

                    let referenceMCS = userToMachineCS(state.sled.reference);

                    let referenceASteps = distanceMmToAbsSteps(
                        config.motors.a,
                        hypot(
                            config.beam.motorsDistanceMm / 2 + referenceMCS.xMm,
                            referenceMCS.yMm
                        )
                    ) - state.sled.reference.aSteps;

                    let referenceBSteps = distanceMmToAbsSteps(
                        config.motors.b,
                        hypot(
                            config.beam.motorsDistanceMm / 2 - referenceMCS.xMm,
                            referenceMCS.yMm
                        )
                    ) - state.sled.reference.bSteps;

                    // let's have triangle MotorA-MotorB-Sled, then:
                    // a is MotorA-Sled, i.e. chain length a
                    // b is MotorA-Sled, i.e. chain length b
                    // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
                    let a = absStepsToDistanceMm(config.motors.a, referenceASteps + state.motors.a.state.steps);
                    let b = absStepsToDistanceMm(config.motors.b, referenceBSteps + state.motors.b.state.steps);
                    let aa = (pow2(a) - pow2(b) + pow2(config.beam.motorsDistanceMm)) / (2 * config.beam.motorsDistanceMm);

                    let position = machineToUserCS({
                        xMm: aa - config.beam.motorsDistanceMm / 2,
                        yMm: sqrt(pow2(a) - pow2(aa))
                    });

                    state.sled.xMm = position.xMm;
                    state.sled.yMm = position.yMm;

                } else {
                    delete state.sled.xMm;
                    delete state.sled.yMm;
                }

            } else {
                delete state.sled.xMm;
                delete state.sled.yMm;
            }
            config.lastPosition.xMm = Math.round(state.sled.xMm * 1000) / 1000;
            config.lastPosition.yMm = Math.round(state.sled.yMm * 1000) / 1000;
            if (!Number.isFinite(config.lastPosition.xMm) || !Number.isFinite(config.lastPosition.yMm)) {
                delete config.lastPosition.xMm;
                delete config.lastPosition.yMm;
            }
        }

        function checkSpindlePosition() {
            if (state.motors.z.state) {

                if (!Number.isFinite(state.spindle.zMm) &&
                    Number.isFinite(config.lastPosition.zMm)) {
                    state.spindle.reference = {
                        zMm: config.lastPosition.zMm,
                        zSteps: state.motors.z.state.steps
                    };
                }

                if (state.spindle.reference) {
                    state.spindle.zMm = state.spindle.reference.zMm + absStepsToDistanceMm(config.motors.z, state.motors.z.state.steps - state.spindle.reference.zSteps);
                } else {
                    delete state.spindle.zMm;
                }

            } else {
                delete state.spindle.zMm;
            }
            config.lastPosition.zMm = Math.round(state.spindle.zMm * 1000) / 1000;
            if (!Number.isFinite(config.lastPosition.zMm)) {
                delete config.lastPosition.zMm;
            }
        }

        async function checkTarget() {

            if (
                Number.isFinite(state.sled.xMm) &&
                Number.isFinite(state.sled.yMm) &&
                Number.isFinite(state.spindle.zMm) &&
                state.target
            ) {

                let targetChains = getChainLengths(state.target);
                let sledChains = getChainLengths(state.sled);

                for (let m of ["a", "b", "z"]) {

                    let offset = m === "z" ?
                        state.spindle.zMm - state.target.zMm :
                        targetChains[m + "Mm"] - sledChains[m + "Mm"];

                    let motor = state.motors[m];

                    let duty = 0;

                    if (abs(offset) > 0.3) {

                        duty = (offset - (motor.offset || 0) / 2) * config.motors[m].offsetToDuty;

                        duty = sign(duty) * min(abs(duty), 1);
                        duty = sign(duty) * pow(abs(duty), 1 / 4);

                        //duty = (motor.duty + duty) / 2;

                        if (abs(duty - motor.duty) > 0.4 && sign(duty) === -sign(motor.duty)) {
                            duty = 0;
                        }
                    }

                    motor.duty = duty || 0;
                    motor.offset = offset;
                }
            } else {
                for (let m of ["a", "b", "z"]) {
                    delete state.motors[m].offset;
                }
            }
        }

        function checkHooverRelay() {
            state.relays.hoover.on = state.relays.spindle.state && state.relays.spindle.state.on && state.spindle.zMm < 0 || false;
        }

        function checkJobSynchronizers() {
            while (waiters.length) {
                let waiter = waiters.shift();
                if (state.jobInterrupt) {
                    let e = new Error("Move interrupted");
                    e.moveInterrupted = true;
                    waiter.reject(e);
                } else {
                    waiter.resolve(state);
                }

            }
        }

        function checkMachineListeners() {
            let newHash = objectHash(state);
            if (newHash !== stateHash) {
                stateHash = newHash;

                async function notify() {
                    try {
                        stateChangedListenersPending = true;
                        for (listener of stateChangedListeners) {
                            await listener(state);
                        }
                    } finally {
                        stateChangedListenersPending = false;
                    }
                }

                if (!stateChangedListenersPending) {
                    // fork notify
                    notify().catch(e => {
                        logError("Error in machine change notification listener:", e);
                    });
                }
            }
        }

        async function setMotorDuties() {
            for (let name in motors) {
                const m = state.motors[name];
                try {
                    await motors[name].set(m.duty);
                    delete state.errors[`motor.${name}.set`];
                } catch (e) {
                    logError(`Motor ${name} error on set:`, e);
                    state.errors[`motor.${name}.set`] = e.message || e;
                }
            }
        }

        async function setRelayStates() {
            for (let name in relays) {
                const r = state.relays[name];
                try {
                    await relays[name].set(r.on);
                    delete state.errors[`relay.${name}.set`];
                } catch (e) {
                    logError(`Relay ${name} error on set:`, e);
                    state.errors[`relay.${name}.set`] = e.message || e;
                }
            }
        }

        await checkMotorStates();
        await checkRelayStates();
        await checkSledPosition();
        await checkSpindlePosition();
        await checkTarget();
        await checkHooverRelay();
        await checkMachineListeners();
        await checkJobSynchronizers();
        await setMotorDuties();
        await setRelayStates();
    }

    async function machineCheckLoop() {
        while (true) {
            let wait = new Promise(resolve => setTimeout(resolve, config.checkIntervalMs));
            try {
                await checkMachineState();
                delete state.errors.check;
            } catch (e) {
                logError("Error in machine check:", e);
                state.errors.check = e.message || e;
            }
            await wait;
        }
    }

    // fork the check loop
    machineCheckLoop().catch(e => {
        logError("Unhandled error in machine check loop:", e);
    });

    return {

        state,

        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        setUserOrigin(xMm, yMm) {
            state.userOrigin = { xMm, yMm };
        },

        setMotorDuty(motor, duty) {
            state.motors[motor].duty = duty;
        },

        setRelayState(relay, on) {
            state.relays[relay].on = on;
        },

        setSledReference(xMm, yMm) {
            config.motors.a.stretch = 1;
            config.motors.b.stretch = 1;
            state.sled.reference = {
                xMm,
                yMm,
                aSteps: state.motors.a.state.steps,
                bSteps: state.motors.b.state.steps
            };
        },

        setChainStretchCompensation(xMm, yMm) {
            if (!Number.isFinite(state.sled.xMm) || !Number.isFinite(state.sled.yMm)) {
                throw new Error("Please calibrate top at first");
            }
            let reportedChainLengths = getChainLengths({ xMm: state.sled.xMm, yMm, yMm: state.sled.yMm });
            let actualChainLengths = getChainLengths({ xMm, yMm });


            console.info(reportedChainLengths);
            console.info(actualChainLengths);

            config.motors.a.stretch = actualChainLengths.aMm / reportedChainLengths.aMm;
            config.motors.b.stretch = actualChainLengths.bMm / reportedChainLengths.bMm;

            console.info(config.motors.a.stretch, config.motors.b.stretch);
        },

        setSpindleReference(zMm) {
            state.spindle.reference = {
                zMm: zMm,
                zSteps: state.motors.z.state.steps
            };
        },

        setTarget(target) {
            state.target = target;
        },

        synchronizeJob() {
            return new Promise((resolve, reject) => {
                waiters.push({ resolve, reject });
            });
        },

        interruptCurrentJob() {
            state.jobInterrupt = true;
        },

        async doJob(action) {

            if (state.mode !== MODE_STANDBY) {
                throw new Error("Machine not in standby mode");
            }

            state.mode = MODE_JOB;
            try {
                return await action();
            } catch (e) {
                if (!e.moveInterrupted) {
                    throw e;
                }
            } finally {
                state.mode = MODE_STANDBY;
                delete state.jobInterrupt;
                delete state.target;
            }
        }
    }
}