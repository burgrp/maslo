const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");

function distanceMmToAbsSteps(motorConfig, distanceMm) {
    return distanceMm * motorConfig.encoderPpr * motorConfig.gearRatio / (motorConfig.mmPerRev);
}

function absStepsToDistanceMm(motorConfig, steps) {
    return steps * motorConfig.mmPerRev / (motorConfig.encoderPpr * motorConfig.gearRatio);
}

module.exports = async ({
    drivers,
    driver,
    motors: motorConfigs,
    relays: relayConfigs,
    machineCheckIntervalMs,
    motorsShaftDistanceMm,
    workspace,
    motorsToWorkspaceVerticalMm,
    kinematicsAB,
    sledDiameterMm,
}) => {

    let machine = {
        motors: {},
        relays: {},
        spindle: {},
        userOrigin: {
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + workspace.heightMm
        },
        errors: {},
        sledDiameterMm,
        bitToMaterialAtLoStopMm: 20, // TODO: this is calibration
        currentDutyAB: kinematicsAB.minDuty,
        motorsShaftDistanceMm,
        workspace,
        motorsToWorkspaceVerticalMm
    };

    let machineCheckInProgress = false;
    let moveInProgress = false;
    let moveInterruptRequest = false;

    let stateChangedListeners = [];
    let oldStateJson;

    let pow2 = a => a * a;
    let { sqrt, hypot, abs, cos, sin, PI, sign, round, ceil, min, max } = Math;

    let centRound = a => round(a * 100) / 100;
    let crdStr = c => `${centRound(c.xMm || c.x)},${centRound(c.yMm || c.y)}`;

    function calculateChainLengthMm(pos) {
        return {
            aMm: hypot(motorsShaftDistanceMm / 2 + pos.xMm, pos.yMm),
            bMm: hypot(motorsShaftDistanceMm / 2 - pos.xMm, pos.yMm)
        };
    };

    if (!drivers[driver]) {
        throw new Error(`Unknown machine driver "${driver}"`);
    }

    driver = drivers[driver];
    await driver.open();

    let motorDrivers = {};
    for (let name in motorConfigs) {
        motorDrivers[name] = await driver.createMotor(name, motorConfigs[name]);
        machine.motors[name] = {
            stops: [],
            config: motorConfigs[name]
        };
    }

    let relayDrivers = {};
    for (let name in relayConfigs) {
        relayDrivers[name] = await driver.createRelay(name, relayConfigs[name]);
        machine.relays[name] = relayDrivers[name].state;
    }

    async function checkMachineState() {

        if (!machineCheckInProgress) {
            try {
                machineCheckInProgress = true;

                try {
                    for (let motor in machine.motors) {
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
                    }

                    if (!machine.positionReference) {
                        machine.positionReference = { // TODO: this is calibration, now assume motor is at 0,1500 (0,250 user)
                            xMm: 500,
                            yMm: 700,
                            aSteps: machine.motors.a.driver.steps,
                            bSteps: machine.motors.b.driver.steps
                        };
                    }

                    if (machine.positionReference) {

                        // calculate step counter as sled would be at motor A
                        let originASteps = distanceMmToAbsSteps(motorConfigs.a, hypot(machine.motorsShaftDistanceMm / 2 + machine.positionReference.xMm, machine.positionReference.yMm)) - machine.positionReference.aSteps;
                        let originBSteps = distanceMmToAbsSteps(motorConfigs.b, hypot(machine.motorsShaftDistanceMm / 2 - machine.positionReference.xMm, machine.positionReference.yMm)) - machine.positionReference.bSteps;

                        // chain lengths
                        let a = absStepsToDistanceMm(motorConfigs.a, machine.motors.a.driver.steps + originASteps);
                        let b = absStepsToDistanceMm(motorConfigs.b, machine.motors.b.driver.steps + originBSteps);

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
                        machine.spindle.depthMm = absStepsToDistanceMm(motorConfigs.z, machine.motors.z.driver.steps - machine.motors.z.stops[0].steps) - machine.bitToMaterialAtLoStopMm;
                    } else {
                        delete machine.spindle.depthMm;
                    }

                    delete machine.errors.machineCheck;
                } catch (e) {
                    let message = e.message || e;
                    delete machine.sledPosition;
                    machine.errors.machineCheck = message;
                    throw e;
                }

            } finally {
                machineCheckInProgress = false;
            }

        }
    }

    function checkMachineListeners() {
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
    }

    function scheduleNextMachineCheck() {
        setTimeout(async () => {
            try {
                await checkMachineState();
            } catch (e) {
                logError("Error in regular machine check", e);
            }
            try {
                checkMachineListeners();
            } catch (e) {
                logError("Error in regular machine check listeners", e);
            }
            scheduleNextMachineCheck();
        }, machineCheckIntervalMs);
    }

    scheduleNextMachineCheck();

    // async function moveRelativeXY({ xMm, yMm, speedMmPerMin }) {
    //     checkSledPosition();
    //     await moveAbsoluteXY({ xMm: machine.sledPosition.xMm + xMm, yMm: machine.sledPosition.yMm + yMm, speedMmPerMin });
    // }

    // async function moveRelativeABZ(motor, distanceMm, speedMmPerMin) {
    //     //throw new Error("Not implemented yet.");

    //     let xMm0 = machine.sledPosition.xMm;
    //     let yMm0 = machine.sledPosition.yMm;
    //     let r = 100;

    //     let line = (x0, y0, x1, y1) => ({
    //         sweep: pos => ({ x: x0 + pos * (x1 - x0), y: y0 + pos * (y1 - y0) }),
    //         lengthMm: hypot(x1 - x0, y1 - y0),
    //         speedMmPerMin
    //     });

    //     await run([
    //         {
    //             sweep: pos => ({ x: xMm0 + r * cos(PI * (pos - 0.5)), y: yMm0 + r + r * sin(PI * (pos - 0.5)) }),
    //             lengthMm: PI * r,
    //             speedMmPerMin
    //         },
    //         line(xMm0, yMm0 + 2 * r, xMm0 - r, yMm0 + 2 * r),
    //         line(xMm0 - r, yMm0 + 2 * r, xMm0 - r, yMm0),
    //         line(xMm0 - r, yMm0, xMm0, yMm0)
    //     ]);

    // }

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return machine;
        },

        async moveXY({ xMm, yMm, speedMmPerMin = kinematicsAB.fullSpeedMmPerMin, firstMove }) {

            if (moveInProgress) {
                throw new Error("Another move in progress.");
            }

            logInfo(`-------- moveXY ${centRound(xMm)},${centRound(yMm)} at ${centRound(speedMmPerMin)}mm/min${firstMove ? " first move" : ""} --------`);

            try {
                moveInProgress = true;

                if (!machine.sledPosition) {
                    throw new Error("Unknown sled position.");
                }

                machine.targetPosition = { xMm, yMm };
                if (firstMove) {
                    machine.currentDutyAB = kinematicsAB.minDuty;
                }

                moveInterruptRequest = false;

                await checkMachineState();

                let sled = machine.sledPosition;

                let distanceMm = hypot(xMm - sled.xMm, yMm - sled.yMm);
                if (distanceMm > 0.01) {

                    let lastDistanceMm;
                    let stallCounter = 0;

                    let xExtMm = sled.xMm + 1 * (xMm - sled.xMm);
                    let yExtMm = sled.yMm + 1 * (yMm - sled.yMm);

                    while (true) {

                        await checkMachineState();

                        if (moveInterruptRequest) {
                            let error = new Error("Move interrupted.");
                            error.moveInterrupted = true;
                            throw error;
                        }

                        let duties = {};

                        let chainLengthsMm = calculateChainLengthMm({ xMm: xExtMm, yMm: yExtMm });

                        for (let [motor, motorHorizontalPositionMm] of [
                            ['a', -machine.motorsShaftDistanceMm / 2],
                            ['b', machine.motorsShaftDistanceMm / 2]
                        ]) {
                            let config = machine.motors[motor].config;
                            let originSteps = distanceMmToAbsSteps(config,
                                hypot(
                                    motorHorizontalPositionMm - machine.positionReference.xMm,
                                    machine.positionReference.yMm
                                ))
                                - machine.positionReference[motor + "Steps"];

                            let currentSteps = machine.motors[motor].driver.steps;
                            let distanceToExtAbsSteps = distanceMmToAbsSteps(config, chainLengthsMm[motor + "Mm"]);
                            let distanceToExtRelSteps = distanceToExtAbsSteps - originSteps - currentSteps;

                            duties[motor] = distanceToExtRelSteps;
                        }

                        let normalize = max(abs(duties.a), abs(duties.b)) / machine.currentDutyAB;

                        duties.b = duties.b / normalize;
                        duties.a = duties.a / normalize;

                        for (let motor in duties) {
                            duties[motor] = (machine.motors[motor].driver.duty + duties[motor]) / 2;
                            if (sign(machine.motors[motor].driver.duty) * sign(duties[motor]) === -1) {
                                logInfo(`reversing motor ${motor}`);
                                duties[motor] = 0;
                                machine.currentDutyAB = max(machine.currentDutyAB - kinematicsAB.slowDownOnReverse, kinematicsAB.minDuty);
                                break;
                            }
                        }
                        machine.currentDutyAB = machine.currentDutyAB + (min(speedMmPerMin / kinematicsAB.fullSpeedMmPerMin, 1) - machine.currentDutyAB) * kinematicsAB.accelerationFactor;

                        for (let motor in duties) {
                            await motorDrivers[motor].set(duties[motor]);
                        }

                        sled = machine.sledPosition;
                        let distanceMm = round(hypot(xMm - sled.xMm, yMm - sled.yMm) * 100) / 100;
                        logInfo(`move target:${crdStr({ xMm, yMm })} sled:${crdStr(machine.sledPosition)} dist:${distanceMm} M:${centRound(machine.currentDutyAB)} A:${centRound(duties.a)} B:${centRound(duties.b)}`);

                        if (distanceMm > lastDistanceMm && distanceMm < 1) {
                            break;
                        }

                        if (distanceMm === lastDistanceMm) {
                            stallCounter++
                        } else {
                            stallCounter = 0;
                        }

                        if (stallCounter > 10) {
                            logInfo("motor stall");
                            break;
                        }

                        lastDistanceMm = distanceMm;
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }

                }

            } finally {
                moveInProgress = false;
            }
        },

        async stopAB() {
            logInfo("stop AB");
            delete machine.targetPosition;
            await motorDrivers.a.set(0);
            await motorDrivers.b.set(0);
        },

        async interruptMove() {
            moveInterruptRequest = true;
        },

        async setMotorDuty(motor, duty) {
            await motorDrivers[motor].set(duty);
        },

        // async manualMoveStart(kind, ...direction) {

        //     function getMoveSpeed() {
        //         if (!isFinite(machine.spindle.depthMm)) {
        //             throw new Error("Unknown position of router bit. Please calibrate.");
        //         }

        //         return machine.spindle.depthMm < 0 ?
        //             moveSpeedRapidMmPerMin :
        //             moveSpeedCuttingMmPerMin;
        //     }

        //     if (kind == "a" || kind == "b") {

        //         await moveRelativeABZ(
        //             kind,
        //             direction[0] * manualMoveMm.ab,
        //             getMoveSpeed()
        //         );

        //     } if (kind == "z") {

        //         await moveRelativeABZ(
        //             kind,
        //             direction[0] * manualMoveMm.z,
        //             30
        //         );

        //     } else if (kind === "xy") {
        //         await moveRelativeXY({
        //             xMm: direction[0] * manualMoveMm.xy,
        //             yMm: direction[1] * manualMoveMm.xy,
        //             speedMmPerMin: getMoveSpeed()
        //         });
        //         await moveStop();
        //     }
        // },

        // async manualMoveStop(kind) {
        //     // if (motorDrivers[kind]) {
        //     //     await motorDrivers[kind].stop();
        //     // } else if (kind === "xy") {
        //     //     await Promise.allSettled([
        //     //         motorDrivers.a.stop(),
        //     //         motorDrivers.b.stop()
        //     //     ]);
        //     // }
        // },

        // async manualSwitch(relay, state) {
        //     await relayDrivers[relay].switch(state);
        // },

        async setUserOrigin(xMm, yMm) {
            machine.userOrigin = { xMm, yMm };
        }
    }
}