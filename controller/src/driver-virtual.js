const Debug = require("debug");

module.exports = async ({ z: zConfig }) => {

    function now() {
        return new Date().getTime();
    }

    return {
        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            let stopCurrentMove;
            let pulseCounter = 0;
            let moving = false;

            let lo = {};
            let hi = {};

            function checkStops() {
                lo.stop = pulseCounter <= -1000;
                hi.stop = pulseCounter >= 2000;
            }

            checkStops();

            return {
                name,

                getState() {
                    return {
                        pulses: pulseCounter,
                        lo,
                        hi,
                        moving
                    }
                },

                async move(pulses, timeMs) {

                    let ranToTheEnd = false;

                    if (moving) {
                        throw new Error("Already moving");
                    }
                    moving = true;

                    log(`move ${pulses} pulses in ${timeMs} ms`);

                    let startedAtMs = now();
                    let startedPulses = pulseCounter;

                    function update() {
                        if (ranToTheEnd) {
                            pulseCounter = Math.round(startedPulses + pulses);
                        } else {
                            let actualTimeMs = now() - startedAtMs;
                            pulseCounter = startedPulses + Math.ceil(pulses * actualTimeMs / timeMs);
                        }

                        checkStops();

                        log(`pulses: ${pulseCounter}`);
                        listener();
                    }

                    let updateInterval = setInterval(update, 100);

                    try {

                        await new Promise((resolve, reject) => {
                            endTimeout = setTimeout(() => {
                                clearInterval(updateInterval);
                                ranToTheEnd = true;
                                resolve();
                            }, timeMs);
                            stopCurrentMove = () => {
                                clearInterval(updateInterval);
                                resolve();
                            };
                        });

                    } finally {
                        moving = false;
                        update();
                        log(`move finished`, pulseCounter);
                    }
                },

                async stop() {
                    log(`stop`);
                    if (stopCurrentMove) {
                        stopCurrentMove();
                    }
                }
            }
        },

        async createRelay(name, listener) {
            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                getState() {
                    return on;
                },
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    if (newOn !== on) {
                        on = newOn;
                        listener();
                    }
                }
            }
        }

    }

}