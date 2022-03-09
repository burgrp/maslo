const logError = require("debug")("app:machine:error");
const logInfo = require("debug")("app:machine:info");


let { hypot, abs } = Math;

module.exports = async ({
    config,
    hardware,
    kinematics
}) => {

    let model = {
        busy: false,
        errors: {}
    }

    await hardware.initializeModel(model)
    await kinematics.initializeModel(model)

    let waiters = [];

    async function checkModel() {

        await hardware.readHardware(model);
        await kinematics.updateKinematics(model)

        while (waiters.length) {
            let waiter = waiters.shift();
            if (model.taskInterrupt) {
                let e = new Error("Move interrupted");
                e.taskInterrupted = true;
                waiter.reject(e);
            } else {
                waiter.resolve(model);
            }

        }

        await hardware.writeHardware(model);

    }

    async function machineCheckLoop() {
        while (true) {
            let wait = new Promise(resolve => setTimeout(resolve, config.checkIntervalMs));
            try {
                await checkModel();
                delete model.errors.check;
            } catch (e) {
                logError("Error in machine check:", e);
                model.errors.check = e.message || e;
            }
            await wait;
        }
    }

    // fork the check loop
    machineCheckLoop().catch(e => {
        logError("Unhandled error in machine check loop:", e);
    });

    return {

        model,

        setMotorDuty(motor, duty) {
            model.motors[motor].duty = duty;
        },

        setRelayState(relay, on) {
            model.relays[relay].on = on;
        },

        calibrateTop(xMm, yMm) {
            model.sled.reference = {
                xMm,
                yMm,
                aSteps: model.motors.a.state.steps,
                bSteps: model.motors.b.state.steps
            };
        },

        calibrateBottom(xMm, yMm) {
            if (!model.sled.reference) {
                throw new Error("No sled reference. Please calibrate top at first.");
            }
            for (let motor of ['a', 'b']) {

                let p1 = model.sled.reference;
                let p2 = {
                    xMm,
                    yMm,
                    aSteps: model.motors.a.state.steps,
                    bSteps: model.motors.b.state.steps
                }

                let calcLen = pos => hypot(config.beam.motorsDistanceMm / 2 - abs(pos.xMm), config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 - pos.yMm);

                let len1mm = calcLen(p1);
                let len2mm = calcLen(p2);

                if (abs(len2mm - len1mm) < 200) {
                    throw new Error("Calibration distances too small");
                }

                let steps1 = p1[motor + "Steps"];
                let steps2 = p2[motor + "Steps"];

                config.motors[motor].stepsPerMm = (steps1 - steps2) / (len1mm - len2mm);

                logInfo(`Motor ${motor} stepsPerMm set to ${config.motors[motor].stepsPerMm}`);
            }
        },

        calibrateSpindle(zMm) {
            model.spindle.reference = {
                zMm: zMm,
                zSteps: model.motors.z.state.steps
            };
        },

        setTarget(target) {
            model.target = target;
        },

        synchronizeTask() {
            return new Promise((resolve, reject) => {
                waiters.push({ resolve, reject });
            });
        },

        interruptTask() {
            model.taskInterrupt = true;
        },

        async doTask(action) {

            if (model.busy) {
                throw new Error("Machine is busy by other task");
            }

            model.busy = true;
            try {
                return await action();
            } catch (e) {
                if (!e.taskInterrupted) {
                    throw e;
                }
            } finally {
                model.busy = false;
                delete model.taskInterrupt;
                delete model.target;
            }
        },

    }
}