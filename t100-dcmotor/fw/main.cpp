int LED_PIN = 22;
int SAFEBOOT_PIN = 8;

/*
class LedPulseTimer : public genericTimer::Timer {

  void onTimer() { target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN); }

public:
  void pulse() {
    target::PORT.OUTSET.setOUTSET(1 << LED_PIN);
    start(1);
  }
};

*/

class I2CSlave : public atsamd::i2c::Slave {
public:
  unsigned char rxBuffer[128];
  unsigned char txBuffer[128];

  void init() { Slave::init(0x50, &target::SERCOM0, rxBuffer, sizeof(rxBuffer), txBuffer, sizeof(txBuffer)); }
};

I2CSlave i2cSlave;

void interruptHandlerSERCOM0() {
  target::PORT.OUTTGL.setOUTTGL(1 << LED_PIN);
  i2cSlave.interruptHandlerSERCOM();
}

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(SAFEBOOT_PIN, false, LED_PIN);

//    target::SYSCTRL.OSC8M.setPRESC(target::sysctrl::OSC8M::PRESC::_1);

  // I2C pins

  target::PORT.PMUX[7].setPMUXE(target::port::PMUX::PMUXE::C);
  target::PORT.PMUX[7].setPMUXO(target::port::PMUX::PMUXO::C);

  target::PORT.PINCFG[14].setPMUXEN(true);
  target::PORT.PINCFG[15].setPMUXEN(true);

  // clock to SERCOM0

  target::PM.APBCMASK.setSERCOM(0, true);

  target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                             .setID(target::gclk::CLKCTRL::ID::SERCOM0_CORE)
                             .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                             .setCLKEN(true);

  i2cSlave.init();

  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);

}
