const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");
const objectHash = require("object-hash");


function distanceMmToAbsSteps(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / motorConfig.mmPerRev;
}

function absStepsToDistanceMm(motorConfig, steps) {
    return steps * motorConfig.mmPerRev / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

let pow2 = a => a * a;
let { sqrt, hypot, abs, round, min, max, sign } = Math;

const MODE_STANDBY = "STANDBY";
const MODE_JOB = "JOB";

module.exports = async ({
    drivers,
    driver: driverConfig,
    checkIntervalMs,
    geometry,
    motors: motorConfigs,
    relays: relayConfigs,
    configuration
}) => {

    let state = {
        mode: MODE_STANDBY,
        beam: {
            ...geometry.beam
        },
        workspace: {
            ...geometry.workspace
        },
        sled: {
            ...geometry.sled
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

    let driverInstance = drivers[driverConfig];
    await driverInstance.open();

    let motors = {};
    for (let name in motorConfigs) {
        motors[name] = await driverInstance.createMotor(name, motorConfigs[name]);
        state.motors[name] = {
            duty: 0
        };
    }

    let relays = {};
    for (let name in relayConfigs) {
        relays[name] = await driverInstance.createRelay(name, relayConfigs[name]);
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
            yMm: state.beam.motorsToWorkspaceMm + state.workspace.heightMm / 2 - pos.yMm
        }
    }

    function machineToUserCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: state.beam.motorsToWorkspaceMm + state.workspace.heightMm / 2 - pos.yMm
        }
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

                if (!state.sled.position &&
                    configuration.data.lastPosition &&
                    isFinite(configuration.data.lastPosition.xMm) &&
                    isFinite(configuration.data.lastPosition.yMm)) {
                    state.sled.reference = {
                        xMm: configuration.data.lastPosition.xMm,
                        yMm: configuration.data.lastPosition.yMm,
                        aSteps: state.motors.a.state.steps,
                        bSteps: state.motors.b.state.steps
                    };
                }

                if (state.sled.reference) {

                    let referenceMCS = userToMachineCS(state.sled.reference);

                    let referenceASteps = distanceMmToAbsSteps(
                        motorConfigs.a,
                        hypot(
                            state.beam.motorsDistanceMm / 2 + referenceMCS.xMm,
                            referenceMCS.yMm
                        )
                    ) - state.sled.reference.aSteps;

                    let referenceBSteps = distanceMmToAbsSteps(
                        motorConfigs.b,
                        hypot(
                            state.beam.motorsDistanceMm / 2 - referenceMCS.xMm,
                            referenceMCS.yMm
                        )
                    ) - state.sled.reference.bSteps;

                    // let's have triangle MotorA-MotorB-Sled, then:
                    // a is MotorA-Sled, i.e. chain length a
                    // b is MotorA-Sled, i.e. chain length b
                    // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
                    let a = absStepsToDistanceMm(motorConfigs.a, referenceASteps + state.motors.a.state.steps);
                    let b = absStepsToDistanceMm(motorConfigs.b, referenceBSteps + state.motors.b.state.steps);
                    let aa = (pow2(a) - pow2(b) + pow2(state.beam.motorsDistanceMm)) / (2 * state.beam.motorsDistanceMm);

                    state.sled.position = machineToUserCS({
                        xMm: aa - state.beam.motorsDistanceMm / 2,
                        yMm: sqrt(pow2(a) - pow2(aa))
                    });

                } else {
                    delete state.sled.position;
                }

            } else {
                delete state.sled.position;
            }
        }

        function checkSpindlePosition() {
            if (state.motors.z.state) {

                if (!isFinite(state.spindle.zMm) &&
                    configuration.data.lastPosition &&
                    isFinite(configuration.data.lastPosition.zMm)) {
                    state.spindle.reference = {
                        zMm: configuration.data.lastPosition.zMm,
                        zSteps: state.motors.z.state.steps
                    };
                }

                if (state.spindle.reference) {
                    state.spindle.zMm = state.spindle.reference.zMm + absStepsToDistanceMm(motorConfigs.z, state.motors.z.state.steps - state.spindle.reference.zSteps);
                } else {
                    delete state.spindle.zMm;
                }

            } else {
                delete state.spindle.zMm;
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
        await checkHooverRelay();
        await checkMachineListeners();
        await checkJobSynchronizers();
        await setMotorDuties();
        await setRelayStates();
    }

    async function machineCheckLoop() {
        while (true) {
            let wait = new Promise(resolve => setTimeout(resolve, checkIntervalMs));
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
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return state;
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
            state.sled.reference = {
                xMm,
                yMm,
                aSteps: state.motors.a.state.steps,
                bSteps: state.motors.b.state.steps
            };
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

        getChainLengths(positionUCS) {
            let positionMCS = userToMachineCS(positionUCS);
            return {
                aMm: hypot(state.beam.motorsDistanceMm / 2 + positionMCS.xMm, positionMCS.yMm),
                bMm: hypot(state.beam.motorsDistanceMm / 2 - positionMCS.xMm, positionMCS.yMm)
            };
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