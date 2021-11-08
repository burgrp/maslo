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
    motorsShaftDistanceMm,
    motorsToWorkspaceVerticalMm,
    sledDiameterMm,
    workspace,
    machineCheckIntervalMs,
    kinematicsAB,
    kinematicsZ,
    configuration
}) => {

    let machine = {
        mode: "STANDBY",
        motors: {},
        relays: {},
        spindle: {},
        userOrigin: {
            xMm: -workspace.widthMm / 2,
            yMm: motorsToWorkspaceVerticalMm + workspace.heightMm
        },
        errors: {},
        sledDiameterMm,
        motorsShaftDistanceMm,
        workspace,
        motorsToWorkspaceVerticalMm
    };

    let machineCheckInProgress = false;

    let moveInProgressXY = false;
    let moveInProgressZ = false;

    let moveInterrupt = false;

    let stateChangedListeners = [];
    let oldStateJson;

    let pow2 = a => a * a;
    let { sqrt, hypot, abs, round, min, max, sign } = Math;

    let centRound = a => round(a * 100) / 100;

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

                    if (
                        !machine.positionReferenceXY &&
                        configuration.data.lastPosition &&
                        isFinite(configuration.data.lastPosition.xMm) &&
                        isFinite(configuration.data.lastPosition.yMm)
                    ) {
                        machine.positionReferenceXY = {
                            xMm: configuration.data.lastPosition.xMm,
                            yMm: configuration.data.lastPosition.yMm,
                            aSteps: machine.motors.a.driver.steps,
                            bSteps: machine.motors.b.driver.steps
                        };
                    }

                    if (!machine.positionReferenceZ &&
                        configuration.data.lastPosition &&
                        isFinite(configuration.data.lastPosition.zMm)
                    ) {
                        machine.positionReferenceZ = {
                            zMm: configuration.data.lastPosition.zMm,
                            zSteps: machine.motors.z.driver.steps,
                        }
                    }


                    if (machine.positionReferenceXY) {

                        // calculate step counter as sled would be at motor A
                        let originASteps = distanceMmToAbsSteps(motorConfigs.a, hypot(machine.motorsShaftDistanceMm / 2 + machine.positionReferenceXY.xMm, machine.positionReferenceXY.yMm)) - machine.positionReferenceXY.aSteps;
                        let originBSteps = distanceMmToAbsSteps(motorConfigs.b, hypot(machine.motorsShaftDistanceMm / 2 - machine.positionReferenceXY.xMm, machine.positionReferenceXY.yMm)) - machine.positionReferenceXY.bSteps;

                        // chain lengths
                        let a = absStepsToDistanceMm(motorConfigs.a, originASteps - machine.motors.a.driver.steps);
                        let b = absStepsToDistanceMm(motorConfigs.b, originBSteps - machine.motors.b.driver.steps);

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

                    if (machine.positionReferenceZ) {
                        machine.spindle.zMm = absStepsToDistanceMm(motorConfigs.z, machine.motors.z.driver.steps - machine.positionReferenceZ.zSteps) + machine.positionReferenceZ.zMm;
                    } else {
                        delete machine.spindle.zMm;
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

    function checkInterrupt() {
        if (moveInterrupt) {
            moveInterrupt = false;
            let error = new Error("Move interrupted");
            error.moveInterrupted = true;
            throw error;
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

    return {
        onStateChanged(listener) {
            stateChangedListeners.push(listener);
        },

        getState() {
            return machine;
        },

        async moveXY({ xMm, yMm, speedMmPerMin }) {

            if (moveInProgressXY) {
                throw new Error("Another move in progress.");
            }

            try {
                moveInProgressXY = true;

                if (!machine.sledPosition) {
                    throw new Error("Unknown sled position.");
                }

                machine.targetPosition = { xMm, yMm };

                await checkMachineState();

                let sled = machine.sledPosition;

                let distanceMm = round(hypot(xMm - sled.xMm, yMm - sled.yMm) * 100) / 100;
                if (distanceMm > 0.01) {

                    let duties = {};

                    let chainLengthsMm = calculateChainLengthMm({ xMm, yMm });

                    speedMmPerMin = min(speedMmPerMin, kinematicsAB.fullSpeedMmPerMin);

                    for (let [motor, motorHorizontalPositionMm] of [
                        ['a', -machine.motorsShaftDistanceMm / 2],
                        ['b', machine.motorsShaftDistanceMm / 2]
                    ]) {
                        let config = machine.motors[motor].config;
                        let originSteps = distanceMmToAbsSteps(config,
                            hypot(
                                motorHorizontalPositionMm - machine.positionReferenceXY.xMm,
                                machine.positionReferenceXY.yMm
                            ))
                            - machine.positionReferenceXY[motor + "Steps"];

                        let currentSteps = machine.motors[motor].driver.steps;
                        let distanceToExtAbsSteps = distanceMmToAbsSteps(config, chainLengthsMm[motor + "Mm"]);
                        let distanceToExtRelSteps = distanceToExtAbsSteps - originSteps - currentSteps;

                        duties[motor] = distanceToExtRelSteps;

                    }

                    let normalize = max(abs(duties.a), abs(duties.b)) / (speedMmPerMin / kinematicsAB.fullSpeedMmPerMin);

                    duties.a = duties.a / normalize;
                    duties.b = duties.b / normalize;

                    logInfo(`move XY ${centRound(xMm)},${centRound(yMm)} at ${centRound(speedMmPerMin)}mm/min dist:${centRound(distanceMm)}mm A:${centRound(duties.a)} B:${centRound(duties.b)}`);

                    let currentDuties = {
                        a: machine.motors.a.driver.duty,
                        b: machine.motors.b.driver.duty
                    };

                    let isReversing = motor => sign(duties[motor]) === -sign(currentDuties[motor]);

                    if (isReversing("a") || isReversing("b")) {
                        await motorDrivers.a.set(0);
                        await motorDrivers.b.set(0);
                        currentDuties = { a: 0, b: 0 };
                        let waitMs = max(abs(duties.a - currentDuties.a), abs(duties.b - currentDuties.b)) * (kinematicsAB.reversingDelayMs - 100) + 100;
                        logInfo(`motor reversing, inserting ${round(waitMs)}ms delay...`);
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                    }

                    let needsDumping = motor => abs(duties[motor] - currentDuties[motor]) > 0.2;
                    if (needsDumping("a") || needsDumping("b")) {
                        logInfo(`dumping motors`, currentDuties, duties);
                        duties.a = (duties.a + 2 * currentDuties.a) / 3;
                        duties.b = (duties.b + 2 * currentDuties.b) / 3;
                    }

                    for (let motor in duties) {
                        await motorDrivers[motor].set(duties[motor]);
                    }

                    let lastDistanceMm;
                    let stallCounter = 0;
                    let accuracyMm = speedMmPerMin * kinematicsAB.speedToAccuracyFactor;

                    while (true) {
                        checkInterrupt();

                        await checkMachineState();

                        sled = machine.sledPosition;
                        let distanceMm = round(hypot(xMm - sled.xMm, yMm - sled.yMm) * 100) / 100;

                        if (distanceMm > lastDistanceMm || distanceMm <= accuracyMm) {
                            break;
                        }

                        if (distanceMm === lastDistanceMm) {
                            stallCounter++
                        } else {
                            stallCounter = 0;
                        }

                        if (stallCounter > kinematicsAB.maxStalls) {
                            logInfo("motor ab stall");
                            break;
                        }

                        lastDistanceMm = distanceMm;

                        await new Promise(resolve => setTimeout(resolve, kinematicsAB.checkPeriodMs));
                    }

                }

            } finally {
                moveInProgressXY = false;
            }
        },

        async stopAB() {
            logInfo("stop AB");
            delete machine.targetPosition;
            await motorDrivers.a.set(0);
            await motorDrivers.b.set(0);
        },

        async interruptMove() {
            if (moveInProgressXY || moveInProgressZ) {
                moveInterrupt = true;
            }
            await relayDrivers.spindle.switch(false);
        },

        async moveZ({ zMm }) {

            if (moveInProgressZ) {
                throw new Error("Another move in progress.");
            }

            try {
                moveInProgressZ = true;

                try {

                    let lastDistanceMm;
                    let stallCounter = 0;
                    let direction;

                    await relayDrivers.spindle.switch(zMm < kinematicsZ.spindleOnBellowMm);

                    while (true) {
                        checkInterrupt();

                        await checkMachineState();
                        let distanceMm = machine.spindle.zMm - zMm;

                        if (!isFinite(direction)) {
                            direction = sign(distanceMm);
                        }

                        if (distanceMm * direction <= kinematicsZ.accuracyMm * direction) {
                            break;
                        }

                        if (distanceMm === lastDistanceMm) {
                            stallCounter++
                        } else {
                            stallCounter = 0;
                        }

                        if (stallCounter > kinematicsZ.maxStalls) {
                            logInfo(`motor z stall`);
                            break;
                        }

                        lastDistanceMm = distanceMm;

                        let duty = (max(min(distanceMm, 1), -1) + 4 * machine.motors.z.driver.duty) / 5;

                        logInfo(`move Z ${centRound(zMm)} at dist:${centRound(distanceMm)}mm duty:${centRound(duty)}`);

                        await motorDrivers.z.set(duty);
                        await new Promise(resolve => setTimeout(resolve, kinematicsZ.checkPeriodMs));
                    }

                } finally {
                    await motorDrivers.z.set(0);
                }

            } finally {
                moveInProgressZ = false;
            }
        },

        async setMotorDuty(motor, duty) {
            await motorDrivers[motor].set(duty);
        },

        async setUserOrigin(xMm, yMm) {
            machine.userOrigin = { xMm, yMm };
        },

        async switchRelay(relay, state) {
            await relayDrivers[relay].switch(state);
        },

        async setMode(mode) {
            let prevMode = machine.mode;
            machine.mode = mode;
            await checkMachineState();
            return prevMode;
        },

        checkStandbyMode() {
            if (machine.mode !== "STANDBY") {
                throw new Error("Machine not in standby mode");
            }
        },

        async setCalibrationXY(workspaceTopToSledTopMm) {
            machine.positionReferenceXY = {
                xMm: 0,
                yMm: motorsToWorkspaceVerticalMm + sledDiameterMm / 2 + workspaceTopToSledTopMm,
                aSteps: machine.motors.a.driver.steps,
                bSteps: machine.motors.b.driver.steps
            };
        },

        async setCalibrationZ(zMm) {
            machine.positionReferenceZ = {
                zMm: zMm,
                zSteps: machine.motors.z.driver.steps
            };
        }

    }
}