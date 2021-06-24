process.env.DEBUG = process.env.DEBUG || "app:*";

require("@device.farm/appglue")({ require, file: __dirname + "/../config.json" }).main(async ({
    webserver,
    router
}) => {
    await webserver.start();
    await router.loadLocalFile("test1.nc");
});