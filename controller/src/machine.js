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
        bitToMaterialAtLoStopMm: 20, // TODO: this is calibration
        motorsShaftDistanceMm,
        workspaceWidthMm,
        workspaceHeightMm,
        motorsToWorkspaceVerticalMm
    };

    let stateChangedListeners = [];
    let oldStateJson;

    let pow2 = a => a * a;
    let { sqrt, hypot, abs, cos, sin, PI, sign, round, ceil, min, max } = Math;

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
            stops: []
        };
    }

    let relayDrivers = {};
    for (let name in relayConfigs) {
        relayDrivers[name] = await driver.createRelay(name, relayConfigs[name]);
        machine.relays[name] = relayDrivers[name].state;
    }

    let machineCheckInProgress = false;

    async function checkMachineState() {

        if (!machineCheckInProgress) {
            try {
                machineCheckInProgress = true;

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
                checkMachineListeners();
            } catch (e) {
                logError("Error in regular machine check", e);
            }
            scheduleNextMachineCheck();
        }, machineCheckIntervalMs);
    }

    scheduleNextMachineCheck();



    async function run(segments) {

        let moveMm = 1;

        let minSpeedMmPerMin = 200;
        let maxSpeedMmPerMin = 2000;
        let speedChangePerMove = 100;

        let window = [];
        let windowSize = ceil(2 * (maxSpeedMmPerMin - minSpeedMmPerMin) / speedChangePerMove);

        function checkWindow() {
            for (let i = 0; i < window.length; i++) {
                if (
                    (i > 0 && i < window.length - 1) && (
                        (window[i - 1].aMm - window[i].aMm) * (window[i].aMm - window[i + 1].aMm) < 0 ||
                        (window[i - 1].bMm - window[i].bMm) * (window[i].bMm - window[i + 1].bMm) < 0
                    ) ||
                    window[i].first ||
                    window[i].last
                ) {
                    for (let r = 0; r < windowSize / 2; r++) {

                        function speedLimit(offset) {
                            if (i + offset >= 0 && i + offset < window.length) {
                                window[i + offset].speedMmPerMin = min(window[i + offset].speedMmPerMin,
                                    minSpeedMmPerMin + r * speedChangePerMove
                                );
                            }
                        }

                        speedLimit(+r);
                        speedLimit(-r);
                    }
                }

            }
        }

        for (let { sweep, lengthMm, speedMmPerMin } of segments) {

            let moveCount = ceil(lengthMm / moveMm);

            for (let posMm = 0; posMm <= lengthMm; posMm = posMm + lengthMm / moveCount) {

                let { x: xMm, y: yMm } = sweep(posMm / lengthMm);
                let { aMm, bMm } = calculateChainLengthMm({ xMm, yMm });

                if (window.length === 0 || (window[window.length - 1].aMm !== aMm && window[window.length - 1].bMm !== bMm)) {

                    window.push({
                        aMm,
                        bMm,
                        xMm,
                        yMm,
                        speedMmPerMin,
                        ...window.length === 0 ? { first: true } : {}
                    });

                    checkWindow();

                    while (window.length > 10) {
                        await push(window.shift());
                    }

                }
            }

        }

        window[window.length - 1].last = true;
        checkWindow();

        while (window.length > 0) {
            await push(window.shift());
        }

        delete machine.followPosition;
    }

    async function moveAbsoluteXY({ xMm, yMm, speedMmPerMin }) {

        let move;

        machine.targetPosition = { xMm, yMm };

        await checkMachineState();

        let sled = machine.sledPosition;
        let distanceMm = hypot(xMm - sled.xMm, yMm - sled.yMm);
        if (distanceMm > 0.01) {


            let newDuties = {};

            let chainLengthsMm = calculateChainLengthMm({xMm, yMm});;

            for (let [motor, motorHorizontalPositionMm] of [
                ['a', -machine.motorsShaftDistanceMm / 2],
                ['b', machine.motorsShaftDistanceMm / 2]
            ]) {
                let config = motorConfigs[motor];

                let originSteps = distanceMmToSteps(motorConfigs[motor],
                    hypot(
                        motorHorizontalPositionMm - machine.positionReference.xMm,
                        machine.positionReference.yMm
                    ))
                    - machine.positionReference[motor + "Steps"];

                let currentSteps = machine.motors[motor].driver.steps;
                let targetSteps = distanceMmToSteps(config, chainLengthsMm[motor + "Mm"]);
                let distanceSteps = targetSteps - originSteps - currentSteps;

                let duty = speedMmPerMin * distanceSteps / 100000;

                if (duty > 1) {
                    duty = 1;
                }
                if (duty < -1) {
                    duty = -1;
                }

                newDuties[motor] = duty;
            }

            logInfo(`speed: ${speedMmPerMin}mm/min A:${centRound(machine.motors.a.driver.duty)}->${centRound(newDuties.a)} B:${centRound(machine.motors.b.driver.duty)}->${centRound(newDuties.b)}`);

            let coordStr = c => `${centRound(c.xMm || c.x)},${centRound(c.yMm || c.y)}`;

            let lastDistanceMm;
            let stallCounter = 0;
            while (true) {

                await checkMachineState();

                for (let motor in newDuties) {
                    let duty = machine.motors[motor].driver.duty;
                    let s = sign(newDuties[motor] - duty);
                    duty += s * 0.1;
                    if (s * duty > s * newDuties[motor]) {
                        duty = newDuties[motor];
                    }
                    if (duty > 1) {
                        duty = 1;
                    }
                    if (duty < -1) {
                        duty = -1;
                    }
                    await motorDrivers[motor].set(duty);
                    //console.info(`${motor} ${s * 0.1} ${duty}`);
                }

                sled = machine.sledPosition;
                let distanceMm = round(hypot(xMm - sled.xMm, yMm - sled.yMm) * 100) / 100
                logInfo(`  dist: ${distanceMm} sled: ${coordStr(machine.sledPosition)} move: ${coordStr({xMm, yMm})}`);

                if (distanceMm > lastDistanceMm) {
                    break;
                }

                if (distanceMm === lastDistanceMm) {
                    stallCounter++
                } else {
                    stallCounter = 0;
                }

                if (stallCounter > 5) {
                    break;
                }

                lastDistanceMm = distanceMm;
                await new Promise(resolve => setTimeout(resolve, 10));
            }

        }

    }

    async function moveStop() {
        await motorDrivers.a.set(0);
        await motorDrivers.b.set(0);
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
                await moveStop();
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