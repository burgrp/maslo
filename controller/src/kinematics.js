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

    function calculateSpindlePosition(model) {
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

    function calculateSledPosition(model) {
        for (let m of ["a", "b", "z"]) {
            prevMotorOffMm[m] = model.motors[m].offMm;
            model.motors[m].offMm = 0;
        }

        let mapping = mappings[model.mapping];

        let absSteps = model.motors.a.state && model.motors.b.state && {
            a: model.motors.a.state.steps,
            b: model.motors.b.state.steps
        };

        if (
            !model.sled.originSteps &&
            absSteps &&
            config.lastPosition.sled
        ) {
            let lastSteps = mapping.positionToSteps(config.lastPosition.sled);
            model.sled.originSteps = {
                a: absSteps.a - lastSteps.a,
                b: absSteps.b - lastSteps.b,
            };
        }

        model.sled.position = absSteps && model.sled.originSteps && mapping.stepsToPosition({
            a: model.sled.originSteps.a - absSteps.a,
            b: model.sled.originSteps.b - absSteps.b
        });

        config.lastPosition.sled = model.sled.position && { ...model.sled.position };

        if (model.sled.position && model.target) {
            let targetChains = mapping.positionToSteps(model.target);
            let sledChains = mapping.positionToSteps(model.sled.position);

            for (let m of ["a", "b"]) {
                let offMm = stepsToDistanceMm(config.motors[m], targetChains[m] - sledChains[m]);
                model.motors[m].offMm = offMm;
            }
        } else {
            for (let m of ["a", "b"]) {
                delete model.motors[m].offMm;
            }
        }
    }

    function calculateMotorDuties(model) {
        for (let m of ["a", "b", "z"]) {

            let motor = model.motors[m];

            if (Number.isFinite(motor.offMm)) {
                let duty = 0;

                if (abs(motor.offMm) > 0.3) {

                    let speed = (motor.offMm - (prevMotorOffMm[m] || 0) / 2) * config.motors[m].offsetToSpeed;

                    duty = sign(speed) * min(pow(abs(speed), 1 / 4), 1);

                    if (abs(duty - motor.duty) > 0.4 && sign(duty) === -sign(motor.duty)) {
                        duty = 0;
                    }
                }

                motor.duty = duty || 0;
            }

        }
    }

    let prevMotorOffMm = {};

    return {

        async initializeModel(model) {
            model.sled = {
            };
            model.spindle = {
                on: false
            };
        },

        async updateKinematics(model) {
            calculateSledPosition(model);
            calculateSpindlePosition(model);
            calculateMotorDuties(model);
        },

        calibrateSled(model, xMm, yMm) {
            delete model.sled.originSteps;
            config.lastPosition.sled = { xMm, yMm };
        }

    }

}