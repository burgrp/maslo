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
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + 500,
            speedMmPerMin: moveSpeedRapidMmPerMin
        },
        userOrigin: {
            xMm: 0,
            yMm: motorsToWorkspaceVerticalMm + workspaceHeightMm
        },
        positionReference: { // TODO: this is calibration
            xMm: -100,
            yMm: motorsToWorkspaceVerticalMm + 700,
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

                        //let timeMs = 60000 * base(pos2.x - pos1.x, pos2.y - pos1.y) / speedMmPerMin;

                        await Promise.allSettled([
                            motorDrivers.a.set(machine.motors.a.steps + distanceMmToSteps(motorConfigs.a, len2.a - len1.a), 1),
                            motorDrivers.b.set(machine.motors.b.steps + distanceMmToSteps(motorConfigs.b, len2.b - len1.b), 1)
                        ]);

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

        // if (!state.positionReference) {
        //     throw new Error("No position reference");
        // }

        // let base = (a, b) => Math.sqrt(a * a + b * b);

        // let length = pos => ({
        //     a: base(motorsShaftDistanceMm / 2 + pos.x, pos.y),
        //     b: base(motorsShaftDistanceMm / 2 - pos.x, pos.y)
        // });

        // let pos1 = { x: state.sledPosition.xMm, y: state.sledPosition.yMm };
        // let pos2 = { x: xMm, y: yMm };

        // let len1 = length(pos1);
        // let len2 = length(pos2);

        // let timeMs = 60000 * base(pos2.x - pos1.x, pos2.y - pos1.y) / speedMmPerMin;

        // await Promise.allSettled([
        //     motorDrivers.a.move(distanceMmToSteps(motorConfigs.a, len2.a - len1.a), 1),
        //     motorDrivers.b.move(distanceMmToSteps(motorConfigs.b, len2.b - len1.b), 1)
        // ]);

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