int LED_PIN = 22;
int ADDR_PIN = 3;
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
  unsigned char rxBuffer[4];
  unsigned char txBuffer[2];

  void init(int axis) {
    target::PORT.PMUX[7].setPMUXE(target::port::PMUX::PMUXE::C);
    target::PORT.PMUX[7].setPMUXO(target::port::PMUX::PMUXO::C);

    target::PORT.PINCFG[14].setPMUXEN(true);
    target::PORT.PINCFG[15].setPMUXEN(true);

    target::PM.APBCMASK.setSERCOM(0, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::SERCOM0_CORE)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    Slave::init(0x50, 0x51 + axis, atsamd::i2c::AddressMode::TWO, &target::SERCOM0);
  }

  virtual bool setRxByte(int index, int value) {
    if (index < sizeof(rxBuffer)) {
      rxBuffer[index] = value;
      return true;
    } else {
      return false;
    }
  }
};

I2CSlave i2cSlave;

int readConfigPin(int pin) {
  
  target::PORT.DIRCLR = 1 << pin;
  target::PORT.PINCFG[pin].setINEN(true).setPULLEN(true);

  target::PORT.OUTSET = 1 << pin;
  int puValue = (target::PORT.IN >> pin) & 1;

  target::PORT.OUTCLR = 1 << pin;
  int pdValue = (target::PORT.IN >> pin) & 1;

  target::PORT.PINCFG[pin].setINEN(false).setPULLEN(false);

  return (puValue && pdValue)? 0: (!puValue && !pdValue)? 1: 2;
}

void interruptHandlerSERCOM0() {
  i2cSlave.interruptHandlerSERCOM();
}

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(SAFEBOOT_PIN, false, LED_PIN);

  i2cSlave.init(readConfigPin(ADDR_PIN));

  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
}
