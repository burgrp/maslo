const Debug = require("debug");

module.exports = async ({ }) => {

    function now() {
        return new Date().getTime();
    }

    return {
        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            let stopCurrentMove;
            let pulseCounter = 0;
            let moving = false;

            return {
                name,

                getPulses() {
                    return pulseCounter
                },

                isMoving() {
                    return moving;
                },

                getEndStop(n) {
                    return n == 0 ? pulseCounter <= 0 : false;
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
                        update();
                        log(`move finished`, pulseCounter);
                        moving = false;
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

        async createRelay(name, config, listener) {
            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                ...config,
                isOn() {
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