int LED_PIN = 22;
int IRQ_PIN = 5;
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

// target::PORT.OUTSET.setOUTSET(1 << LED_PIN);
// target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN);

enum State { IDLE = 0, RUNNING = 1, FINISHED = 2, ERROR = 3 };

enum Command { NONE = 0, SETUP = 1, START = 2, STOP = 3 };

class Device : public atsamd::i2c::Slave, public genericTimer::Timer {
public:
  struct __attribute__((packed)) {
    unsigned char command = Command::NONE;
    union {
      struct __attribute__((packed)) {
        int endSteps;
        unsigned int endTime;
        unsigned char startImmediatelly;
      } setup;
    };
  } rxBuffer;
  unsigned char txBuffer[2];

  State state = State::IDLE;
  Stopwatch stopwatch;
  int endSteps;
  unsigned int endTime;

  void init(int axis) {
    stopwatch.init();

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

    // IRQ

    target::PORT.OUTSET.setOUTSET(1 << IRQ_PIN);
    target::PORT.DIRSET.setDIRSET(1 << IRQ_PIN);


    Slave::init(0x50, 0x51 + axis, atsamd::i2c::AddressMode::TWO, &target::SERCOM0);
  }

  void startNow() {
    state = State::RUNNING;
    stopwatch.start();
    start(1); // start the check timer
  }

  void stopNow() {
    state = State::IDLE;
    endSteps = 0;
    endTime = 0;

    target::PORT.OUTCLR.setOUTCLR(1 << LED_PIN);
  }

  void checkState() {

    if (state == State::RUNNING) {
      target::PORT.OUTTGL.setOUTTGL(1 << LED_PIN);    

      // we should be stopped by step counter, this is a timeout check
      if (stopwatch.getTime() > endTime) {
        stopNow();
      }
    }
  }

  bool checkCommand(Command command, int index, int value, int paramsSize) {
    return rxBuffer.command == command && index == paramsSize;
  }

  virtual int getTxByte(int index) { return state; }

  virtual bool setRxByte(int index, int value) {

    if (index < sizeof(rxBuffer)) {
      ((unsigned char *)&rxBuffer)[index] = value;

      if (checkCommand(Command::SETUP, index, value, sizeof(rxBuffer.setup))) {
        this->endSteps += rxBuffer.setup.endSteps;
        this->endTime += rxBuffer.setup.endTime;
        if (rxBuffer.setup.startImmediatelly) {
          startNow();
        }
      }

      if (checkCommand(Command::START, index, value, 0)) {
        startNow();
      }

      return true;
    } else {
      return true;
    }
  }

  void onTimer() {
    checkState();
    if (state == State::RUNNING) {
      start(2); // restart the check timer
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
