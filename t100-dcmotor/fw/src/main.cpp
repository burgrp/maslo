int LED_PIN = 22;
int IRQ_PIN = 5;
int ADDR_PIN = 3;
int SAFEBOOT_PIN = 8;

int PWM_PIN = 16;

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

// target::PORT.OUTSET.setOUTSET(1 << LED_PIN);
// target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN);

enum State { IDLE = 0, RUNNING = 1, ERROR = 2 };

enum Command { NONE = 0, START = 1, STOP = 2 };

class Device : public atsamd::i2c::Slave {
public:
  struct __attribute__((packed)) {
    unsigned char command = Command::NONE;
    union {
      struct __attribute__((packed)) {
        int endSteps;
      } start;
    };
  } rxBuffer;
  unsigned char txBuffer[2];

  State state = State::IDLE;
  PWM pwm;
  int endSteps;
  unsigned int endTime;

  void init(int axis) {

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    pwm.init(&target::TC1, PWM_PIN);

    // I2C

    target::PORT.PMUX[7].setPMUXE(target::port::PMUX::PMUXE::C);
    target::PORT.PMUX[7].setPMUXO(target::port::PMUX::PMUXO::C);

    target::PORT.PINCFG[14].setPMUXEN(true);
    target::PORT.PINCFG[15].setPMUXEN(true);

    target::PM.APBCMASK.setSERCOM(0, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::SERCOM0_CORE)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    Slave::init(0x50 + axis, 0, atsamd::i2c::AddressMode::MASK, &target::SERCOM0);

    // IRQ

    target::PORT.OUTSET.setOUTSET(1 << IRQ_PIN);
    target::PORT.DIRSET.setDIRSET(1 << IRQ_PIN);
  }

  void irqSet() { target::PORT.OUTCLR.setOUTCLR(1 << IRQ_PIN); }

  void irqClear() { target::PORT.OUTSET.setOUTSET(1 << IRQ_PIN); }

  void startNow() {
    state = State::RUNNING;
    target::PORT.OUTSET.setOUTSET(1 << LED_PIN);
  }

  void stopNow(bool setIrq) {
    state = State::IDLE;
    target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN);
    if (setIrq) {
      irqSet();
    }
  }

  bool checkCommand(Command command, int index, int value, int paramsSize) {
    return rxBuffer.command == command && index == paramsSize;
  }

  virtual int getTxByte(int index) {
    irqClear();
    return state;
  }

  virtual bool setRxByte(int index, int value) {

    if (index < sizeof(rxBuffer)) {
      ((unsigned char *)&rxBuffer)[index] = value;

      if (checkCommand(Command::START, index, value, sizeof(rxBuffer.start))) {
        this->endSteps += rxBuffer.start.endSteps;
        startNow();
      }

      if (checkCommand(Command::STOP, index, value, 0)) {
        stopNow(false);
      }

      return true;
    } else {
      return true;
    }
  }
};

Device device;

void interruptHandlerSERCOM0() { device.interruptHandlerSERCOM(); }

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(SAFEBOOT_PIN, false, LED_PIN);

  // MCU clocked at 8MHz
  target::SYSCTRL.OSC8M.setPRESC(target::sysctrl::OSC8M::PRESC::_1);

  device.init(readConfigPin(ADDR_PIN));

  // enable interrupts
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
}
