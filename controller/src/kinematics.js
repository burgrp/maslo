module.exports = async ({
    config
}) => {

    let pow2 = a => a * a;
    let { sqrt, pow, hypot, abs, round, min, max, sign } = Math;

    function stepsPerMm(motorConfig) {
        return motorConfig.encoderPpr * motorConfig.gearRatio / motorConfig.mmPerRev;
    }

    function distanceMmToSteps(motorConfig, distanceMm) {
        return distanceMm * stepsPerMm(motorConfig);
    }

    function stepsToDistanceMm(motorConfig, steps) {
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

    let mappings = {

        trigonometry: {

            stepsToPosition(steps) {

                // let's have triangle MotorA-MotorB-Sled, then:
                // a is MotorA-Sled, i.e. chain length a
                // b is MotorA-Sled, i.e. chain length b
                // aa is identical to MotorA-MotorB, going from MotorA to intersection with vertical from Sled
                let a = stepsToDistanceMm(config.motors.a, steps.a);
                let b = stepsToDistanceMm(config.motors.b, steps.b);
                let aa = (pow2(a) - pow2(b) + pow2(config.beam.motorsDistanceMm)) / (2 * config.beam.motorsDistanceMm);

                return machineToUserCS({
                    xMm: aa - config.beam.motorsDistanceMm / 2,
                    yMm: sqrt(pow2(a) - pow2(aa))
                });
            },

            positionToSteps(positionUCS) {
                let positionMCS = userToMachineCS(positionUCS);
                return {
                    a: distanceMmToSteps(config.motors.a, hypot(config.beam.motorsDistanceMm / 2 + positionMCS.xMm, positionMCS.yMm)),
                    b: distanceMmToSteps(config.motors.b, hypot(config.beam.motorsDistanceMm / 2 - positionMCS.xMm, positionMCS.yMm))
                };

            }

        }
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

    function checkTarget(model, mapping) {

        if (
            Number.isFinite(model.sled.xMm) &&
            Number.isFinite(model.sled.yMm) &&
            Number.isFinite(model.spindle.zMm) &&
            model.target
        ) {

            let targetChains = mapping.positionToSteps(model.target);
            let sledChains = mapping.positionToSteps(model.sled);

            for (let m of ["a", "b", "z"]) {

                let offsetMm = m === "z" ?
                    model.spindle.zMm - model.target.zMm :
                    stepsToDistanceMm(config.motors[m], targetChains[m] - sledChains[m]);

                let motor = model.motors[m];

                let duty = 0;

                if (abs(offsetMm) > 0.3) {

                    let speed = (offsetMm - (motor.offsetMm || 0) / 2) * config.motors[m].offsetToSpeed;

                    duty = sign(speed) * min(pow(abs(speed), 1 / 4), 1);

                    if (abs(duty - motor.duty) > 0.4 && sign(duty) === -sign(motor.duty)) {
                        duty = 0;
                    }
                }

                motor.duty = duty || 0;
                motor.offsetMm = offsetMm;
            }
        } else {
            for (let m of ["a", "b", "z"]) {
                delete model.motors[m].offsetMm;
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

            let mapping = mappings[model.mapping];

            let absSteps = model.motors.a.state && model.motors.b.state && {
                a: model.motors.a.state.steps,
                b: model.motors.b.state.steps
            };

            if (
                !model.sled.originSteps &&
                absSteps &&
                Number.isFinite(config.lastPosition.xMm) &&
                Number.isFinite(config.lastPosition.yMm)
            ) {
                let lastSteps = mapping.positionToSteps(config.lastPosition);
                model.sled.originSteps = {
                    a: absSteps.a - lastSteps.a,
                    b: absSteps.b - lastSteps.b,
                };
            }

            let sledPosition = absSteps && model.sled.originSteps && mapping.stepsToPosition({
                a:  model.sled.originSteps.a - absSteps.a,
                b:  model.sled.originSteps.b - absSteps.b
            });

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
            checkTarget(model, mapping);
        },

        calibrateSled(model, xMm, yMm) {
            delete model.sled.originSteps;
            config.lastPosition.xMm = xMm;
            config.lastPosition.yMm = yMm;
        }

    }

}