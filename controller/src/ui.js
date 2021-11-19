const logError = require("debug")("app:ui:error");

module.exports = async ({
    machine,
    manualMotorControl,
    manualCuttingSpeedMmPerMin,
    manualRapidSpeedMmPerMin,
    router
}) => {
    let events = {
        machine: {
            stateChanged: undefined
        },
        router: {
            jobChanged: undefined
        }
    };

    machine.onStateChanged(state => {
        events.machine.stateChanged(state);
    });

    router.onJobChanged(code => {
        events.router.jobChanged(code);
    });

    let { min, max, abs } = Math;

    async function manualMotorStart(motor, direction) {

        await machine.doJob(async () => {

            try {
                let d = manualMotorControl[motor].min;
                while (true) {
                    d = min(manualMotorControl[motor].max, d + 0.05);
                    machine.setMotorDuty(motor, direction * d);
                    await machine.synchronizeJob();
                }
            } finally {
                machine.setMotorDuty(motor, 0);
            }

        });
    }

    async function manualMoveStart(directionX, directionY) {

        let state = machine.getState();

        if (!state.sled.position) {
            throw new Error(`Unknown sled position`);
        }

        let rapidMove = !state.spindle.on && state.spindle.zMm > 0;

        await router.run([{
            code: rapidMove ? "G0" : "G1",
            x: state.sled.position.xMm + 10000 * directionX,
            y: state.sled.position.yMm + 10000 * directionY,
            f: rapidMove ? manualRapidSpeedMmPerMin : manualCuttingSpeedMmPerMin
        }]);

    }

    let manualMovePending = false;

    return {
        events,
        client: __dirname + "/client",
        api: {
            machine: {
                getState() {
                    return machine.getState();
                },

                async manualMoveStart(kind, ...params) {
                    manualMovePending = true;
                    try {
                        if (kind === "xy") {
                            await manualMoveStart(...params);
                        } else {
                            await manualMotorStart(kind, ...params);
                        }
                    } finally {
                        manualMovePending = false;
                    }
                },

                async manualMoveStop(kind) {
                    if (manualMovePending) {
                        machine.interruptCurrentJob();
                    }
                },

                async manualSwitch(relay, state) {
                    await machine.doJob(async () => {
                        machine.setRelayState(relay, state);
                    });
                },

                async resetUserOrigin() {
                    let state = machine.getState();
                    if (state.sled.position) {
                        if (state.userOrigin.xMm === state.sled.position.xMm && state.userOrigin.yMm === state.sled.position.yMm) {
                            machine.setUserOrigin(0, 0);
                        } else {
                            machine.setUserOrigin(state.sled.position.xMm, state.sled.position.yMm);
                        }
                    }
                },

                async emergencyStop() {
                    machine.interruptCurrentJob();
                },

                async setCalibrationXY(workspaceTopToSledTopMm) {
                    if (!Number.isFinite(workspaceTopToSledTopMm)) {
                        throw new Error("Please enter a valid number");
                    }
                    let state = machine.getState();
                    machine.setSledReference(0, state.workspace.heightMm / 2 - state.sled.diaMm / 2 - workspaceTopToSledTopMm);
                },

                async setCalibrationZ(zMm) {
                    if (!Number.isFinite(zMm)) {
                        throw new Error("Please enter a valid number");
                    }
                    machine.setSpindleReference(zMm);
                }
            },
            router: {
                async getCode() {
                    return await router.getCode();
                },
                async runJob() {
                    await router.runJob();
                },
                async deleteJob() {
                    await router.deleteJob();
                }
            }
        }
    }
}