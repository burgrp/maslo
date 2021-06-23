const logError = require("debug")("app:machine:error");

module.exports = async ({
    machine,
    manualMotorControl,
    moveSpeedRapidMmPerMin,
    moveSpeedCuttingMmPerMin
}) => {
    let events = {
        machine: {
            stateChanged: undefined
        }
    };

    machine.onStateChanged(state => {
        events.machine.stateChanged(state);
    });

    let motorAccelerationTimers = {};

    async function manualMotorStart(motor, direction) {
        if (machine.getState().motors[motor].driver.duty === 0 && !motorAccelerationTimers[motor]) {
            let duty = manualMotorControl[motor].min * direction;
            await machine.setMotorDuty(motor, duty);
            motorAccelerationTimers[motor] = setInterval(async () => {
                try {
                    duty = Math.min(duty + 0.02 * direction, manualMotorControl[motor].max);
                    await machine.setMotorDuty(motor, duty);
                } catch (e) {
                    logError("Error in manual motor acceleration timer", e);
                }
            }, 100);
        }
    }

    async function manualMotorStop(motor) {
        clearInterval(motorAccelerationTimers[motor]);
        delete motorAccelerationTimers[motor];
        await machine.setMotorDuty(motor, 0);
    }

    async function manualMoveStart(directionX, directionY) {
        let state = machine.getState();

        if (!isFinite(state.spindle.depthMm)) {
            throw new Error("Unknown position of router bit. Please calibrate.");
        }

        let speedMmPerMin = state.spindle.depthMm < 0 ? moveSpeedRapidMmPerMin : moveSpeedCuttingMmPerMin;

        if (state.sledPosition) {
            await machine.moveXY({
                xMm: directionX ? directionX * state.workspace.widthMm / 2 : state.sledPosition.xMm,
                yMm: directionY ? state.motorsToWorkspaceVerticalMm + (directionY / 2 + 0.5) * state.workspace.heightMm : state.sledPosition.yMm,
                speedMmPerMin,
                firstMove: true
            });
        }
    }

    async function manualMoveStop() {
    }

    return {
        events,
        client: __dirname + "/client",
        api: {
            machine: {
                getState: machine.getState,

                async manualMoveStart(kind, ...params) {
                    if (kind === "xy") {
                        await manualMoveStart(...params);
                    } else {
                        await manualMotorStart(kind, ...params);
                    }
                },

                async manualMoveStop(kind) {
                    if (kind === "xy") {
                        await manualMoveStop();
                    } else {
                        await manualMotorStop(kind);
                    }
                },

                manualSwitch: machine.manualSwitch,

                async resetUserOrigin() {
                    let state = machine.getState();
                    if (state.sledPosition) {
                        if (state.userOrigin.xMm === state.sledPosition.xMm && state.userOrigin.yMm === state.sledPosition.yMm) {
                            await machine.setUserOrigin(0, state.motorsToWorkspaceVerticalMm + state.workspace.heightMm);
                        } else {
                            await machine.setUserOrigin(state.sledPosition.xMm, state.sledPosition.yMm);
                        }
                    }
                }
            }
        }
    }
}