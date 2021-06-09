const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");

function distanceMmToSteps(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.mmPerRev);
}

function stepsToDistanceMm(motorConfig, steps) {
    return steps * motorConfig.mmPerRev / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

module.exports = async ({
    drivers,
    driver,
    motors: motorConfigs,
    relays: relayConfigs,
    machineCheckIntervalMs,
    moveSpeedRapidMmPerMin,
    moveSpeedCuttingMmPerMin,
    motorsShaftDistanceMm,
    workspaceWidthMm,
    workspaceHeightMm,
    motorsToWorkspaceVerticalMm,
    manualMoveMm,
    motorMinDuty
}) => {

    let machine = {
        motors: {},
        relays: {},
        spindle: {},
        userOrigin: {
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + workspaceHeightMm
        },
        positionReference: { // TODO: this is calibration
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + 500,
            aSteps: 0,
            bSteps: 0
        },
        bitToMaterialAtLoStopMm: 20, // TODO: this is calibration
        motorsShaftDistanceMm,
        workspaceWidthMm,
        workspaceHeightMm,
        motorsToWorkspaceVerticalMm
    };

    let stateChangedListeners = [];
    let oldStateJson;

    let pow2 = a => a * a;
    let { sqrt, hypot, abs, cos, sin, PI, sign } = Math;

    if (!drivers[driver]) {
        throw new Error(`Unknown machine driver "${driver}"`);
    }

    driver = drivers[driver];
    await driver.open();

    let motorDrivers = {};
    for (let name in motorConfigs) {
        motorDrivers[name] = await driver.createMotor(name, motorConfigs[name]);
        machine.motors[name] = {
            stops: []
        };
    }

    let relayDrivers = {};
    for (let name in relayConfigs) {
        relayDrivers[name] = await driver.createRelay(name, relayConfigs[name]);
        machine.relays[name] = relayDrivers[name].state;
    }

    let machineCheckInProgress = false;
    setInterval(async () => {

        if (!machineCheckInProgress) {
            try {
                try {
                    machineCheckInProgress = true;

                    for (let motor in machine.motors) {
                        try {
                            let driver = motorDrivers[motor];
                            let state = machine.motors[motor];
                            state.driver = await driver.get();;



                            for (let stopIndex in state.driver.stops) {
                                state.stops[stopIndex] = state.stops[stopIndex] || {};

                                let stop = state.stops[stopIndex];

                                if (state.driver.stops[stopIndex] && !stop.state) {
                                    stop.steps = machine.motors[motor].driver.steps;
                                }

                                stop.state = state.driver.stops[stopIndex];
                            }
                        } catch (e) {
                            logError("PROPAGATE THIS TO UI:", motor, e);
                            delete machine.motors[motor];
                        }

                    }

                    let motorDuties = {
                        a: {
                            duty: 0
                        },
                        b: {
                            duty: 0
                        }
                    };

                    if (machine.positionReference && machine.motors.a && machine.motors.b) {

                        // calculate step counter as sled would be at motor A
                        let originASteps = distanceMmToSteps(motorConfigs.a, hypot(machine.motorsShaftDistanceMm / 2 + machine.positionReference.xMm, machine.positionReference.yMm)) - machine.positionReference.aSteps;
                        let originBSteps = distanceMmToSteps(motorConfigs.b, hypot(machine.motorsShaftDistanceMm / 2 - machine.positionReference.xMm, machine.positionReference.yMm)) - machine.positionReference.bSteps;

                        // chain lengths
                        let a = stepsToDistanceMm(motorConfigs.a, machine.motors.a.driver.steps + originASteps);
                        let b = stepsToDistanceMm(motorConfigs.b, machine.motors.b.driver.steps + originBSteps);

                        // let's have triangle MotorA-MotorB-Sled, then:
                        // a is MotorA-Sled, i.e. chain length a
                        // b is MotorA-Sled, i.e. chain length b
                        // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
                        let aa = (pow2(a) - pow2(b) + pow2(machine.motorsShaftDistanceMm)) / (2 * machine.motorsShaftDistanceMm);

                        machine.sledPosition = {
                            xMm: aa - machine.motorsShaftDistanceMm / 2,
                            yMm: sqrt(pow2(a) - pow2(aa))
                        };

                    } else {
                        delete machine.sledPosition;
                    }

                    machine.spindle.on = machine.relays.spindle.on;

                    if (isFinite(machine.motors.z.stops[0].steps) && machine.bitToMaterialAtLoStopMm) {
                        machine.spindle.bitToMaterialMm = stepsToDistanceMm(motorConfigs.z, machine.motors.z.driver.steps - machine.motors.z.stops[0].steps) - machine.bitToMaterialAtLoStopMm;
                    } else {
                        delete machine.spindle.bitToMaterialMm;
                    }

                    let follow = machine.followPosition;
                    let sled = machine.sledPosition;

                    if (follow && sled) {

                        let length = pos => ({
                            a: hypot(motorsShaftDistanceMm / 2 + pos.x, pos.y),
                            b: hypot(motorsShaftDistanceMm / 2 - pos.x, pos.y)
                        });

                        let pos1 = { x: sled.xMm, y: sled.yMm };
                        let pos2 = { x: follow.xMm, y: follow.yMm };

                        let len1 = length(pos1);
                        let len2 = length(pos2);

                        for (let motor in motorDuties) {

                            let config = motorConfigs[motor];
                            let distanceSteps = distanceMmToSteps(motorConfigs[motor], len2[motor] - len1[motor]);

                            let speedStepsPerMs = distanceSteps / machineCheckIntervalMs;

                            let maxSpeedStepsPerMs = config.maxRpm * config.encoderPpr / 60000;

                            let duty = speedStepsPerMs / maxSpeedStepsPerMs;

                            if (duty > 1) {
                                duty = 1;
                            }
                            if (duty < -1) {
                                duty = -1;
                            }

                            let reducedTime;
                            if (abs(duty) < motorMinDuty && duty !== 0) {
                                reducedTime = abs(machineCheckIntervalMs * duty / motorMinDuty);
                                duty = sign(duty) * motorMinDuty;
                                logInfo(`Reduced step motor ${motor} duty ${duty} ${reducedTime} ms`);
                            }

                            motorDuties[motor] = { duty, reducedTime };

                        }

                    }

                    for (let motor in motorDuties) {

                        let md = motorDuties[motor];

                        if (machine.motors[motor]) {

                            if (machine.motors[motor].duty !== md.duty) {
                                await motorDrivers[motor].set(md.duty);
                            }
                            if (md.reducedTime) {
                                setTimeout(async () => {
                                    try {
                                        //logInfo(`Reduced time ${md.reducedTime} for motor ${motor} is gone.`)
                                        await motorDrivers[motor].set(0);
                                    } catch (e) {
                                        logError(`Error stopping motor ${motor} in reduced time:`, e);
                                    }
                                }, md.reducedTime);
                            }
                        }
                    }

                    let stateJson = JSON.stringify(machine);
                    if (stateJson !== oldStateJson) {
                        oldStateJson = stateJson;
                        for (let listener of stateChangedListeners) {
                            try {
                                listener(machine);
                            } catch (error) {
                                logError("Error in machine state change listener:", error);
                            }
                        }
                    }


                } finally {
                    machineCheckInProgress = false;
                }
            } catch (e) {
                logError("Error in machine check:", e);
            }
        } else {
            logError("Machine check too slow.");
        }

    }, machineCheckIntervalMs);

    async function run(segments) {
        let stepMs = 100;

        for (let { sweep, lengthMm, speedMmPerMin } of segments) {

            let stepMm = speedMmPerMin / 60000 * stepMs;

            for (let posMm = 0; posMm <= lengthMm; posMm = posMm + stepMm) {
                let { x, y } = sweep(posMm / lengthMm);
                machine.followPosition = {
                    xMm: x,
                    yMm: y
                };
                await new Promise(resolve => setTimeout(resolve, stepMs));
            }

        }

        delete machine.followPosition;
    }

    async function moveAbsoluteXY({ xMm, yMm, speedMmPerMin }) {

        let xMm0 = machine.sledPosition.xMm;
        let yMm0 = machine.sledPosition.yMm;

        await run([{
            sweep: pos => ({ x: xMm0 + pos * (xMm - xMm0), y: yMm0 + pos * (yMm - yMm0) }),
            lengthMm: hypot(xMm - xMm0, yMm - yMm0),
            speedMmPerMin
        }]);
    }

    async function moveRelativeXY({ xMm, yMm, speedMmPerMin }) {
        await moveAbsoluteXY({ xMm: machine.sledPosition.xMm + xMm, yMm: machine.sledPosition.yMm + yMm, speedMmPerMin });
    }

    async function moveRelativeABZ(motor, distanceMm, speedMmPerMin) {
        //throw new Error("Not implemented yet.");

        let xMm0 = machine.sledPosition.xMm;
        let yMm0 = machine.sledPosition.yMm;
        let r = 200;

        let line = (x0, y0, x1, y1) => ({
            sweep: pos => ({ x: x0 + pos * (x1 - x0), y: y0 + pos * (y1 - y0) }),
            lengthMm: hypot(x1 - x0, y1 - y0),
            speedMmPerMin
        });

        await run([
            {
                sweep: pos => ({ x: xMm0 + r * cos(PI * (pos - 0.5)), y: yMm0 + r + r * sin(PI * (pos - 0.5)) }),
                lengthMm: PI * r,
                speedMmPerMin
            },
            line(xMm0, yMm0 + 2 * r, xMm0 - r, yMm0 + 2 * r),
            line(xMm0 - r, yMm0 + 2 * r, xMm0 - r, yMm0),
            line(xMm0 - r, yMm0, xMm0, yMm0)
        ]);

    }

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return machine;
        },

        moveRelativeABZ,
        moveAbsoluteXY,
        moveRelativeXY,

        async manualMoveStart(kind, ...direction) {

            function getMoveSpeed() {
                if (!isFinite(machine.spindle.bitToMaterialMm)) {
                    throw new Error("Unknown position of router bit. Please calibrate.");
                }

                return machine.spindle.bitToMaterialMm < 0 ?
                    moveSpeedRapidMmPerMin :
                    moveSpeedCuttingMmPerMin;
            }

            if (kind == "a" || kind == "b") {

                await moveRelativeABZ(
                    kind,
                    direction[0] * manualMoveMm.ab,
                    getMoveSpeed()
                );

            } if (kind == "z") {

                await moveRelativeABZ(
                    kind,
                    direction[0] * manualMoveMm.z,
                    30
                );

            } else if (kind === "xy") {
                await moveRelativeXY({
                    xMm: direction[0] * manualMoveMm.xy,
                    yMm: direction[1] * manualMoveMm.xy,
                    speedMmPerMin: getMoveSpeed()
                });
            }
        },

        async manualMoveStop(kind) {
            // if (motorDrivers[kind]) {
            //     await motorDrivers[kind].stop();
            // } else if (kind === "xy") {
            //     await Promise.allSettled([
            //         motorDrivers.a.stop(),
            //         motorDrivers.b.stop()
            //     ]);
            // }
        },

        async manualSwitch(relay, state) {
            await relayDrivers[relay].switch(state);
        },

        async setUserOrigin(xMm, yMm) {
            machine.userOrigin = { xMm, yMm };
        }
    }
}