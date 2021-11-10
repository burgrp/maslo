const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");
const objectHash = require("object-hash");


function distanceMmToAbsSteps(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.mmPerRev);
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

module.exports = async ({
    drivers,
    driver: driverConfig,
    checkIntervalMs,
    changeIntervalMs,
    geometry,
    motors: motorConfigs,
    relays: relayConfigs,
    configuration
}) => {

    let state = {
        mode: "STANDBY",
        beam: {
            ...geometry.beam
        },
        workspace: {
            ...geometry.workspace
        },
        sled: {
            ...geometry.sled,
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

    let stateChangedListeners = [];

    function userToMachineCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: state.beam.motorsToWorkspaceMm + state.workspace.heightMm - pos.yMm
        }
    }

    function machineToUserCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: state.beam.motorsToWorkspaceMm + state.workspace.heightMm - pos.yMm
        }
    }

    function checkStandbyMode() {
        if (state.mode !== MODE_STANDBY) {
            throw new Error("Machine not in standby mode");
        }
    }

    async function checkMachineState() {

        for (let name in motors) {
            try {
                const m = state.motors[name];
                motors[name].set(m.duty);
                m.state = await motors[name].get();
                delete m.error;
            } catch(e) {
                console.error(`Motor ${name} error:`, e); 
                m.error = e.message || e;
            }
        }

        for (let name in relays) {
            try {
                const r = state.relays[name];
                relays[name].set(r.on);
                r.state = await relays[name].get();
                delete r.error;
            } catch(e) {
                console.error(`Relay ${name} error:`, e); 
                m.error = e.message || e;
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
                ) + state.sled.reference.aSteps;

                let referenceBSteps = distanceMmToAbsSteps(
                    motorConfigs.b,
                    hypot(
                        state.beam.motorsDistanceMm / 2 - referenceMCS.xMm,
                        referenceMCS.yMm
                    )
                ) + state.sled.reference.bSteps;

                // let's have triangle MotorA-MotorB-Sled, then:
                // a is MotorA-Sled, i.e. chain length a
                // b is MotorA-Sled, i.e. chain length b
                // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
                let a = absStepsToDistanceMm(motorConfigs.a, referenceASteps - state.motors.a.state.steps);
                let b = absStepsToDistanceMm(motorConfigs.b, referenceBSteps - state.motors.b.state.steps);
                let aa = (pow2(a) - pow2(b) + pow2(state.beam.motorsDistanceMm)) / (2 * state.beam.motorsDistanceMm);

                state.sled.position = machineToUserCS({
                    xMm: aa - state.beam.motorsDistanceMm / 2,
                    yMm: sqrt(pow2(a) - pow2(aa))
                });
            }

        } else {
            delete state.sled.position;
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

    let stateHash;

    async function machineChangeLoop() {
        while(true) {
            try {
                let newHash = objectHash(state);
                if (newHash !== stateHash) {
                    stateHash = newHash;
                    for (listener of stateChangedListeners) {
                        await listener(state);
                    }
                }
            } catch(e) {
                console.error("Error in machine change loop:", e);
            }
            await asyncWait(changeIntervalMs);
        }
    }

    // fork the change loop
    machineChangeLoop().catch(e => {
        console.error("Unhandled error in machine change loop:", e);
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

        setManualMotorDuty(motor, duty) {
            checkStandbyMode();
            state.motors[motor].duty = duty;
        }
    }
}