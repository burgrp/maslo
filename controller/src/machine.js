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
    manualMoveMm,
    speedRampMm,
    speedRampMinFactor
}) => {

    let machine = {
        motors: {},
        relays: {},
        spindle: {},
        stops: {},
        userOrigin: {
            xMm: -400,
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

    if (!drivers[driver]) {
        throw new Error(`Unknown machine driver "${driver}"`);
    }

    driver = drivers[driver];
    await driver.open();

    let motorDrivers = {};
    for (let name in motorConfigs) {
        motorDrivers[name] = await driver.createMotor(name, motorConfigs[name]);
        machine.motors[name] = motorDrivers[name].state;
        machine.stops[name] = [];
    }

    let relayDrivers = {};
    for (let name in relayConfigs) {
        relayDrivers[name] = await driver.createRelay(name, relayConfigs[name]);
        machine.relays[name] = relayDrivers[name].state;
    }

    let machineCheckIntervalMs = 100;
    let machineCheckInProgress = false;
    setInterval(async () => {

        if (!machineCheckInProgress) {
            try {
                try {
                    machineCheckInProgress = true;

                    for (let motor in machine.motors) {
                        let driver = motorDrivers[motor];
                        let state = await driver.get();
                        machine.motors[motor] = state;
                        for (let stopIndex in state.stops) {
                            if (machine.stops[motor][stopIndex] === undefined) {
                                machine.stops[motor][stopIndex] = {};
                            }
                            let stop = machine.stops[motor][stopIndex];

                            if (machine.motors[motor].stops[stopIndex] && !stop.state) {
                                stop.steps = machine.motors[motor].steps;
                            }

                            stop.state = machine.motors[motor].stops[stopIndex];
                        }

                    }

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

                        if (!machine.followPosition) {
                            machine.followPosition = { ...machine.sledPosition };
                        }

                        if (!machine.targetPosition) {
                            machine.targetPosition = {
                                ...machine.sledPosition,
                                origin: {
                                    ...machine.sledPosition
                                }
                            };
                        }

                    } else {
                        delete machine.sledPosition;
                    }

                    machine.spindle.on = machine.relays.spindle.on;

                    if (isFinite(machine.stops.z[0].steps) && machine.bitToMaterialAtLoStopMm) {
                        machine.spindle.bitToMaterialMm = stepsToDistanceMm(motorConfigs.z, machine.motors.z.steps - machine.stops.z[0].steps) - machine.bitToMaterialAtLoStopMm;
                    } else {
                        delete machine.spindle.bitToMaterialMm;
                    }

                    let target = machine.targetPosition;
                    let follow = machine.followPosition;

                    if (follow && target) {

                        let distanceToTargetMm = sqrt(p2(target.xMm - follow.xMm) + p2(target.yMm - follow.yMm));
                        let distanceFromOriginMm = sqrt(p2(target.origin.xMm - follow.xMm) + p2(target.origin.yMm - follow.yMm));

                        if (distanceToTargetMm > 0) {

                            let speedRampFactor = Math.max(
                                speedRampMinFactor,
                                Math.min(1,
                                    Math.min(distanceFromOriginMm, distanceToTargetMm) / speedRampMm
                                )
                            );

                            //console.info(`dO: ${Math.round(distanceFromOriginMm * 100) / 100} dT: ${Math.round(distanceToTargetMm * 100) / 100} slf: ${speedRampFactor}`);

                            let distanceToNextTickMm = speedRampFactor * machineCheckIntervalMs * target.speedMmPerMin / 60000;

                            if (distanceToNextTickMm > distanceToTargetMm) {
                                follow.xMm = target.xMm;
                                follow.yMm = target.yMm;
                            } else {
                                let ratio = distanceToNextTickMm / distanceToTargetMm;
                                follow.xMm += (target.xMm - follow.xMm) * ratio;
                                follow.yMm += (target.yMm - follow.yMm) * ratio;
                            }

                        }

                        if (machine.sledPosition) {

                            let length = pos => ({
                                a: sqrt(p2(motorsShaftDistanceMm / 2 + pos.x) + p2(pos.y)),
                                b: sqrt(p2(motorsShaftDistanceMm / 2 - pos.x) + p2(pos.y))
                            });

                            let pos1 = { x: machine.sledPosition.xMm, y: machine.sledPosition.yMm };
                            let pos2 = { x: follow.xMm, y: follow.yMm };

                            let len1 = length(pos1);
                            let len2 = length(pos2);

                            await Promise.all(["a", "b"].map(motor => {
                                let state = machine.motors[motor];
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

                                let dutyAbsDiff = Math.abs(duty - state.duty);
                                if (dutyAbsDiff > 0.5 && !state.breaking) {
                                    let count = Math.ceil(dutyAbsDiff / 0.1);
                                    state.breaking = {
                                        count,
                                        change: (duty - state.duty) / count
                                    }
                                    console.info(`BREAKING START ${motor} ${state.duty}->${duty} change: ${state.breaking.change} count: ${state.breaking.count}`);
                                }

                                if (state.breaking) {
                                    console.info(`BREAKING ${motor} ${state.duty}->${state.duty + state.breaking.change} count: ${state.breaking.count} normal:${duty}`);
                                    if (Math.sign(state.breaking.change) !== Math.sign(duty - state.duty)) {
                                        console.info("BREAK early leave");
                                        delete state.breaking;
                                    } else {
                                        duty = state.duty + state.breaking.change;
                                        state.breaking.count--;
                                        if (!state.breaking.count) {
                                            delete state.breaking;
                                        }
                                    }
                                }

                                if (duty !== state.duty) {
                                    return motorDrivers[motor].set(duty);
                                }

                            }));
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

    async function moveAbsoluteXY(xMm, yMm, speedMmPerMin) {
        machine.targetPosition.xMm = xMm;
        machine.targetPosition.yMm = yMm;
        machine.targetPosition.speedMmPerMin = speedMmPerMin;

        if (machine.followPosition) {
            machine.targetPosition.origin = {
                xMm: machine.followPosition.xMm,
                yMm: machine.followPosition.yMm
            }
        }

        delete machine.motors.a.lastStep;
        delete machine.motors.b.lastStep;
    }

    async function moveRelativeXY(xMm, yMm, speedMmPerMin) {
        await moveAbsoluteXY(machine.targetPosition.xMm + xMm, machine.targetPosition.yMm + yMm, speedMmPerMin);
    }

    async function moveRelativeABZ(motor, distanceMm, speedMmPerMin) {
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