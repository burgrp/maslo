module.exports = async ({
    config
}) => {

    let pow2 = a => a * a;
    let { sqrt, pow, hypot, abs, round, min, max, sign } = Math;

    function stepsPerMm(motorConfig) {
        return motorConfig.encoderPpr * motorConfig.gearRatio / motorConfig.mmPerRev;
    }

    function distanceMmToAbsSteps(motorConfig, distanceMm) {
        return distanceMm * stepsPerMm(motorConfig);
    }

    function absStepsToDistanceMm(motorConfig, steps) {
        return steps / stepsPerMm(motorConfig);
    }

    function userToMachineCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 - pos.yMm
        }
    }

    function machineToUserCS(pos) {
        return {
            xMm: pos.xMm,
            yMm: config.beam.motorsToWorkspaceMm + config.workspace.heightMm / 2 - pos.yMm
        }
    }

    function getChainLengths(positionUCS) {
        let positionMCS = userToMachineCS(positionUCS);
        return {
            aMm: hypot(config.beam.motorsDistanceMm / 2 + positionMCS.xMm, positionMCS.yMm),
            bMm: hypot(config.beam.motorsDistanceMm / 2 - positionMCS.xMm, positionMCS.yMm)
        };
    }

    function stepsToPosition(steps, reference) {

        let referenceMCS = userToMachineCS(reference);

        let referenceASteps = distanceMmToAbsSteps(
            config.motors.a,
            hypot(
                config.beam.motorsDistanceMm / 2 + referenceMCS.xMm,
                referenceMCS.yMm
            )
        ) - reference.aSteps;

        let referenceBSteps = distanceMmToAbsSteps(
            config.motors.b,
            hypot(
                config.beam.motorsDistanceMm / 2 - referenceMCS.xMm,
                referenceMCS.yMm
            )
        ) - reference.bSteps;

        // let's have triangle MotorA-MotorB-Sled, then:
        // a is MotorA-Sled, i.e. chain length a
        // b is MotorA-Sled, i.e. chain length b
        // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
        let a = absStepsToDistanceMm(config.motors.a, referenceASteps + steps.a);
        let b = absStepsToDistanceMm(config.motors.b, referenceBSteps + steps.b);
        let aa = (pow2(a) - pow2(b) + pow2(config.beam.motorsDistanceMm)) / (2 * config.beam.motorsDistanceMm);

        return machineToUserCS({
            xMm: aa - config.beam.motorsDistanceMm / 2,
            yMm: sqrt(pow2(a) - pow2(aa))
        });
    }

    function checkSpindlePosition(model) {
        if (model.motors.z.state) {

            if (!Number.isFinite(model.spindle.zMm) &&
                Number.isFinite(config.lastPosition.zMm)) {
                model.spindle.reference = {
                    zMm: config.lastPosition.zMm,
                    zSteps: model.motors.z.state.steps
                };
            }

            if (model.spindle.reference) {
                model.spindle.zMm = model.spindle.reference.zMm + (config.motors.z, model.motors.z.state.steps - model.spindle.reference.zSteps) / stepsPerMm(config.motors.z);
            } else {
                delete model.spindle.zMm;
            }

        } else {
            delete model.spindle.zMm;
        }
        config.lastPosition.zMm = Math.round(model.spindle.zMm * 1000) / 1000;
        if (!Number.isFinite(config.lastPosition.zMm)) {
            delete config.lastPosition.zMm;
        }
    }

    function checkTarget(model) {

        if (
            Number.isFinite(model.sled.xMm) &&
            Number.isFinite(model.sled.yMm) &&
            Number.isFinite(model.spindle.zMm) &&
            model.target
        ) {

            let targetChains = getChainLengths(model.target);
            let sledChains = getChainLengths(model.sled);

            for (let m of ["a", "b", "z"]) {

                let offset = m === "z" ?
                    model.spindle.zMm - model.target.zMm :
                    targetChains[m + "Mm"] - sledChains[m + "Mm"];

                let motor = model.motors[m];

                let duty = 0;

                if (abs(offset) > 0.3) {

                    let speed = (offset - (motor.offset || 0) / 2) * config.motors[m].offsetToSpeed;

                    duty = sign(speed) * min(pow(abs(speed), 1 / 4), 1);

                    if (abs(duty - motor.duty) > 0.4 && sign(duty) === -sign(motor.duty)) {
                        duty = 0;
                    }
                }

                motor.duty = duty || 0;
                motor.offset = offset;
            }
        } else {
            for (let m of ["a", "b", "z"]) {
                delete model.motors[m].offset;
            }
        }
    }

    return {

        async initializeModel(model) {
            model.sled = {
            };
            model.spindle = {
                on: false
            };
        },

        async updateKinematics(model) {

            let steps = model.motors.a.state && model.motors.b.state && {
                a: model.motors.a.state.steps,
                b: model.motors.b.state.steps
            };

            if (
                !model.sled.reference &&
                steps &&
                Number.isFinite(config.lastPosition.xMm) &&
                Number.isFinite(config.lastPosition.yMm)
            ) {
                model.sled.reference = {
                    xMm: config.lastPosition.xMm,
                    yMm: config.lastPosition.yMm,
                    aSteps: steps.a,
                    bSteps: steps.b
                };
            }

            let sledPosition = steps && model.sled.reference && stepsToPosition(steps, model.sled.reference);

            if (sledPosition) {
                model.sled.xMm = sledPosition.xMm;
                model.sled.yMm = sledPosition.yMm;
                config.lastPosition.xMm = Math.round(model.sled.xMm * 1000) / 1000;
                config.lastPosition.yMm = Math.round(model.sled.yMm * 1000) / 1000;
            } else {
                delete model.sled.xMm;
                delete model.sled.yMm;
                delete config.lastPosition.xMm;
                delete config.lastPosition.yMm;
            }

            checkSpindlePosition(model);
            checkTarget(model);
        }

    }

}