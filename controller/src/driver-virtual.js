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
                stops: [false, false],
                currentMA: 0,
                duty: 0
            };

            let log = Debug(`app:motor:${name}`);

            function checkStops() {
                for (let stopIndex = 0; stopIndex < state.stops.length ; stopIndex++) {
                    state.stops[stopIndex] =
                        stopPositions &&
                        stopPositions[name] &&
                        isFinite(stopPositions[name][stopIndex]) &&
                        state.steps * (stopIndex * 2 - 1) >= stopPositions[name][stopIndex] * (stopIndex * 2 - 1);
                }
            }

            checkStops();

            let checkIntervalMs = 10;
            setInterval(() => {
                let stallDuty = 0.2;
                if (state.duty > stallDuty || state.duty < -stallDuty) {
                    state.steps += config.maxRpm * config.encoderPpr * state.duty / (60000 / checkIntervalMs);
                }
                checkStops();
            }, checkIntervalMs);

            return {
                name,

                async set(duty) {
                    log("set", Math.round(duty * 100) / 100);
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