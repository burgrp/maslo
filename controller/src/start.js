require("@device.farm/appglue")({ require, file: __dirname + "/../config.json" }).main(async ({
    webserver
}) => {
    await webserver.start();
});