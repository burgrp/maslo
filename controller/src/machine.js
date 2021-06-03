const logError = require("debug")("app:error");

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
    moveSpeedRapidMmPerMin,
    moveSpeedCuttingMmPerMin,
    motorsShaftDistanceMm,
    workspaceWidthMm,
    workspaceHeightMm,
    motorsToWorkspaceVerticalMm,
    manualMoveMm
}) => {

    let machine = {
        motors: {},
        relays: {},
        spindle: {},
        followPosition: {
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + 500
        },
        targetPosition: {
            xMm: 1000,
            yMm: motorsToWorkspaceVerticalMm + 1000,
            speedMmPerMin: moveSpeedRapidMmPerMin
        },
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

    let p2 = a => a * a;
    let sqrt = Math.sqrt;

    let calcC = (a, b, base) => (p2(a) - p2(b) + p2(base)) / (2 * base);

    function checkMachine() {

        if (machine.positionReference) {

            // calculate step counter as sled would be at motor A
            let originASteps = distanceMmToSteps(motorConfigs.a, sqrt(p2(machine.motorsShaftDistanceMm / 2 + machine.positionReference.xMm) + p2(machine.positionReference.yMm))) - machine.positionReference.aSteps;
            let originBSteps = distanceMmToSteps(motorConfigs.b, sqrt(p2(machine.motorsShaftDistanceMm / 2 - machine.positionReference.xMm) + p2(machine.positionReference.yMm))) - machine.positionReference.bSteps;

            // chain lengths
            let a = stepsToDistanceMm(motorConfigs.a, machine.motors.a && machine.motors.a.steps + originASteps);
            let b = stepsToDistanceMm(motorConfigs.b, machine.motors.b && machine.motors.b.steps + originBSteps);

            // let's have triangle MotorA-MotorB-Sled, then:
            // a is MotorA-Sled, i.e. chain length a
            // b is MotorA-Sled, i.e. chain length b
            // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
            let aa = calcC(
                a,
                b,
                machine.motorsShaftDistanceMm
            );

            machine.sledPosition = {
                xMm: aa - machine.motorsShaftDistanceMm / 2,
                yMm: sqrt(p2(a) - p2(aa))
            };

        } else {
            delete machine.sledPosition;
        }

        machine.spindle.on = machine.relays.spindle.on;

        if (machine.motors.z && isFinite(machine.motors.z.lo.steps) && machine.bitToMaterialAtLoStopMm) {
            machine.spindle.bitToMaterialMm = stepsToDistanceMm(motorConfigs.z, machine.motors.z.steps - machine.motors.z.lo.steps) - machine.bitToMaterialAtLoStopMm;
        } else {
            delete machine.spindle.bitToMaterialMm;
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
    }

    if (!drivers[driver]) {
        throw new Error(`Unknown machine driver "${driver}"`);
    }

    driver = drivers[driver];
    await driver.open();

    let motorDrivers = {};
    for (let name in motorConfigs) {
        motorDrivers[name] = await driver.createMotor(name, motorConfigs[name]);
        machine.motors[name] = motorDrivers[name].state;
    }

    let relayDrivers = {};
    for (let name in relayConfigs) {
        relayDrivers[name] = await driver.createRelay(name, relayConfigs[name]);
        machine.relays[name] = relayDrivers[name].state;
    }

    async function moveRelativeABZ(motor, distanceMm, speedMmPerMin) {


    }

    let followIntervalMs = 100;
    let followCheckInProgress = false;
    setInterval(async () => {

        if (!followCheckInProgress) {
            try {
                try {
                    followCheckInProgress = true;

                    let target = machine.targetPosition;
                    let follow = machine.followPosition;

                    let distanceToTargetMm = sqrt(p2(target.xMm - follow.xMm) + p2(target.yMm - follow.yMm));
                    if (distanceToTargetMm > 0) {

                        let distanceToNextTickMm = followIntervalMs * target.speedMmPerMin / 60000;

                        if (distanceToNextTickMm > distanceToTargetMm) {
                            follow.xMm = target.xMm;
                            follow.yMm = target.yMm;
                        } else {
                            let ratio = distanceToNextTickMm / distanceToTargetMm;
                            follow.xMm += (target.xMm - follow.xMm) * ratio;
                            follow.yMm += (target.yMm - follow.yMm) * ratio;
                        }

                    }


                    for (let motor of ["a", "b", "z"]) {
                        let driver = motorDrivers[motor];
                        let state = await driver.get();
                        machine.motors[motor] = state;
                    }

                    if (machine.positionReference) {

                        let length = pos => ({
                            a: sqrt(p2(motorsShaftDistanceMm / 2 + pos.x) + p2(pos.y)),
                            b: sqrt(p2(motorsShaftDistanceMm / 2 - pos.x) + p2(pos.y))
                        });

                        checkMachine();

                        let pos1 = { x: machine.sledPosition.xMm, y: machine.sledPosition.yMm };
                        let pos2 = { x: follow.xMm, y: follow.yMm };

                        let len1 = length(pos1);
                        let len2 = length(pos2);

                        await Promise.allSettled(["a", "b"].map(motor => {
                            let state = machine.motors[motor];
                            let config = motorConfigs[motor];
                            let distanceSteps = distanceMmToSteps(motorConfigs[motor], len2[motor] - len1[motor]);

                            if (distanceSteps !== 0) {

                                let directionMultiplier = distanceSteps < 0 ? -1 : 1;
                                let actSteps = machine.motors[motor].steps;

                                let duty;
                                let lastStep = state.lastStep;

                                if (!lastStep) {

                                    duty = isFinite(state.speedToDutyRatio) ? target.speedMmPerMin * state.speedToDutyRatio : 0.5;

                                } else {

                                    duty = lastStep.duty;
                                    let error = actSteps - (lastStep.actSteps + lastStep.distanceSteps);

                                    let correction = -directionMultiplier * 1000 * error / (config.maxRpm * config.encoderPpr * followIntervalMs);
                                    if (correction > 0.1) {
                                        correction = 0.1;
                                    }
                                    if (correction < -0.1) {
                                        correction = -0.1;
                                    }

                                    duty = duty + correction;

                                    if (duty > 1) {
                                        duty = 1;
                                    }
                                    if (duty < 0) {
                                        duty = 0;
                                    }

                                    console.info(`${motor}: err ${Math.round(error)} corr ${Math.round(correction * 1000) / 1000} D ${Math.round(duty * 1000) / 1000}`)
                                }

                                state.lastStep = {
                                    distanceSteps,
                                    actSteps,
                                    duty
                                };

                                state.speedToDutyRatio = duty / target.speedMmPerMin;

                                return motorDrivers[motor].set(actSteps + distanceSteps, duty);
                            }
                        }));
                    }

                    checkMachine();

                } finally {
                    followCheckInProgress = false;
                }
            } catch (e) {
                logError("Error in follow check:", e);
            }
        } else {
            logError("Follow check too slow.");
        }


    }, followIntervalMs);

    async function moveAbsoluteXY(xMm, yMm, speedMmPerMin) {
        machine.targetPosition.xMm = xMm;
        machine.targetPosition.yMm = yMm;
        machine.targetPosition.speedMmPerMin = speedMmPerMin;
        checkMachine();

        delete machine.motors.a.lastStep;
        delete machine.motors.b.lastStep;
    }

    async function moveRelativeXY(xMm, yMm, speedMmPerMin) {
        await moveAbsoluteXY(machine.targetPosition.xMm + xMm, machine.targetPosition.yMm + yMm, speedMmPerMin);
    }

    function scheduleNextCheck() {
        try {
            checkMachine();
        } catch (e) {
            logError("Error in periodic check:", e);
        }
        setTimeout(scheduleNextCheck, 100);
    }

    scheduleNextCheck();

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

                await moveRelativeXY(
                    direction[0] * manualMoveMm.xy,
                    direction[1] * manualMoveMm.xy,
                    getMoveSpeed()
                );

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