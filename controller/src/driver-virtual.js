const Debug = require("debug");

module.exports = async ({ stopPositions }) => {

    function now() {
        return new Date().getTime();
    }

    return {

        async open() {
        },

        async createMotor(name, config) {

            let state = {
                steps: 0,
                lo: {},
                hi: {},
                running: false,
                currentMA: 0,
                duty: 0
            };

            let log = Debug(`app:motor:${name}`);

            let endSteps = 0;

            function checkStops() {
                for (let side of [{ name: "lo", multiplier: -1 }, { name: "hi", multiplier: 1 }]) {
                    let stop = !!stopPositions && !!stopPositions[name] && isFinite(stopPositions[name][side.name]) && state.steps * side.multiplier >= stopPositions[name][side.name] * side.multiplier;
                    if (stop && !state[side.name].stop) {
                        state[side.name].steps = state.steps;
                    }
                    state[side.name].stop = stop;
                }
            }

            checkStops();

            let checkIntervalMs = 10;
            setInterval(() => {
                let stepsPerCheck = config.maxRpm * config.encoderPpr * state.duty / (60000 / checkIntervalMs);
                let diff = state.steps - endSteps;
                state.running = Math.abs(diff) > stepsPerCheck && state.duty > 0.2;
                if (state.running) {
                    state.steps += stepsPerCheck * (diff < 0 ? 1 : -1);
                } else {
                    //if (name !== "z") log("no move");
                }
                checkStops();
            }, checkIntervalMs);

            return {
                name,

                async set(steps, duty) {
                    log(Math.round(steps), Math.round(duty * 100) / 100);
                    endSteps = steps;
                    state.duty = duty;

                },

                async get() {
                    return state;
                }
            }
        },

        async createRelay(name) {
            let log = Debug(`app:relay:${name}`);

            let state = {
                on: false
            };

            return {
                name,
                state,

                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    state.on = newOn;
                }
            }
        }

    }

}