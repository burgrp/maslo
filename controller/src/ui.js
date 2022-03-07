const logError = require("debug")("app:ui:error");

module.exports = async ({
    machine,
    router,
    config
}) => {

    let machineModel = machine.model;

    let events = {
        machine: {
            modelChanged: undefined
        },
        config: {
            modelChanged: undefined
        },
        router: {
            modelChanged: undefined
        }
    };

    function onModelChanged(model, name) {
        if (events[name].modelChanged) {
            events[name].modelChanged(model);
        }
    };

    let { min, max, abs } = Math;

    async function manualMotorStart(motors, direction) {

        motors = motors.split("");

        await machine.doJob(async () => {

            try {
                let d = {};
                for (let motor of motors) {
                    d[motor] = config.model.manual.motorDuty[motor].min;
                }

                while (true) {
                    for (let motor of motors) {
                        d[motor] = min(config.model.manual.motorDuty[motor].max, d[motor] + 0.05);
                        machine.setMotorDuty(motor, direction * d[motor]);
                    }
                    await machine.synchronizeJob();
                }
            } finally {
                for (let motor of motors) {
                    machine.setMotorDuty(motor, 0);
                }
            }

        });
    }

    async function manualMoveStart(directionX, directionY) {

        if (!Number.isFinite(machineModel.sled.xMm) || !Number.isFinite(machineModel.sled.yMm)) {
            throw new Error(`Unknown sled position`);
        }

        let rapidMove = machineModel.relays.spindle.state && !machineModel.relays.spindle.state.on && machineModel.spindle.zMm > 0;

        await router.run([{
            code: rapidMove ? "G0" : "G1",
            x: machineModel.sled.xMm + 10000 * directionX,
            y: machineModel.sled.yMm + 10000 * directionY,
            f: rapidMove ? config.model.speed.xyRapidMmPerMin : config.model.speed.xyDefaultMmPerMin
        }]);

    }

    let manualMovePending = false;

    return {
        events,
        onModelChanged,
        client: __dirname + "/client",
        api: {
            config: {
                getModel() {
                    return config.model;
                },

                merge(data) {
                    delete data.lastPosition;
                    Object.assign(config.model, data);
                }
            },
            machine: {
                getModel() {
                    return machineModel;
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
                    if (Number.isFinite(machineModel.sled.xMm) && Number.isFinite(machineModel.sled.yMm)) {
                        if (config.model.userOrigin.xMm === machineModel.sled.xMm && config.model.userOrigin.yMm === machineModel.sled.yMm) {
                            config.model.userOrigin = {xMm: 0, yMm: 0};
                        } else {
                            config.model.userOrigin = {xMm: machineModel.sled.xMm, yMm: machineModel.sled.yMm};
                        }
                    }
                },

                async emergencyStop() {
                    machine.interruptCurrentJob();
                },

                async setCalibration(kind, value) {
                    await machine.doJob(async () => {
                        
                        if (!Number.isFinite(value)) {
                            throw new Error("Please enter a valid number");
                        }

                        switch (kind) {
                            case "top":
                                machine.setSledReference(0, config.model.workspace.heightMm / 2 - config.model.sled.diaMm / 2 - value);
                                break;
                            case "bottom":
                                machine.recalculateRatio(0, -config.model.workspace.heightMm / 2 + config.model.sled.diaMm / 2 + value);
                                break;
                            case "tool":
                                machine.setSpindleReference(-value);
                                break;
                            default:
                                throw new Error(`Sorry, I don't know how to calibrate ${kind}`);
                        }
                    });
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