const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");
const objectHash = require("object-hash");


function distanceMmToAbsSteps(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / motorConfig.mmPerRev;
}

function absStepsToDistanceMm(motorConfig, steps) {
    return steps * motorConfig.mmPerRev / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

function asyncWait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        relays: {}
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

        for (let name in motors) {
            const m = state.motors[name];
            try {
                motors[name].set(m.duty);
                m.state = await motors[name].get();
                delete m.error;
            } catch (e) {
                console.error(`Motor ${name} error:`, e);
                delete m.state;
                m.error = e.message || e;
            }
        }

        for (let name in relays) {
            const r = state.relays[name];
            try {
                relays[name].set(r.on);
                r.state = await relays[name].get();
                delete r.error;
            } catch (e) {
                console.error(`Relay ${name} error:`, e);
                delete r.state;
                r.error = e.message || e;
            }
        }

        if (state.motors.a.state && state.motors.b.state) {

            if (
                !state.sled.position &&
                configuration.data.lastPosition &&
                isFinite(configuration.data.lastPosition.xMm) &&
                isFinite(configuration.data.lastPosition.yMm)
            ) {
                state.sled.reference = {
                    xMm: configuration.data.lastPosition.xMm,
                    yMm: configuration.data.lastPosition.yMm,
                    aSteps: state.motors.a.state.steps,
                    bSteps: state.motors.b.state.steps
                }
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

        if (state.motors.z.state) {

            if (
                !isFinite(state.spindle.zMm) &&
                configuration.data.lastPosition &&
                isFinite(configuration.data.lastPosition.zMm)
            ) {
                state.spindle.reference = {
                    zMm: configuration.data.lastPosition.zMm,
                    zSteps: state.motors.z.state.steps
                }
            }

            if (state.spindle.reference) {
                state.spindle.zMm = state.spindle.reference.zMm + absStepsToDistanceMm(motorConfigs.z, state.motors.z.state.steps - state.spindle.reference.zSteps);
            } else {
                delete state.spindle.zMm;
            }
            
        } else {
            delete state.spindle.zMm;
        }

        if (state.relays.spindle.state) {
            state.spindle.on = state.relays.spindle.state.on;            
        } else {
            state.spindle.on = false;
        }

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
                    console.error("Error in machine change notification listener:", e);
                });
            }
        }

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

    async function machineCheckLoop() {
        while (true) {
            try {
                await checkMachineState();
            } catch (e) {
                console.error("Error in machine check:", e);
            }
            await asyncWait(checkIntervalMs);
        }
    }

    await checkMachineState();

    // fork the check loop
    machineCheckLoop().catch(e => {
        console.error("Unhandled error in machine check loop:", e);
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
                await action();
            } catch (e) {
                if (!e.moveInterrupted) {
                    throw e;
                } 
            } finally {
                state.mode = MODE_STANDBY;
                delete state.jobInterrupt;
            }
        }
    }
}