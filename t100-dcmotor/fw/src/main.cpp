const int PIN_LED = 24;
const int PIN_ADDR = 3;
const int PIN_SAFEBOOT = 8;

const int PIN_MOTOR1 = 16;
const int PIN_MOTOR2 = 22;

const int PIN_HALL_A = 6;
const int PIN_HALL_B = 7;
const int EXT_INT_HALL_A = 6;
const int EXT_INT_HALL_B = 7;

const int PIN_SDA = 14;
const int PIN_SCL = 15;

const int PIN_STOP1 = 4;
const int PIN_STOP2 = 5;

const int LO_PRIO_CHECK_MS = 100;

const int UNATTENDED_TIMEOUT_MS = 2000;
const int UNATTENDED_TIMEOUT_COUNT = UNATTENDED_TIMEOUT_MS / LO_PRIO_CHECK_MS;

enum Command { NONE = 0, SET = 1 };

class Device {
public:
  class : public atsamd::i2c::Slave {
  public:
    struct __attribute__((packed)) {
      unsigned char command = Command::NONE;
      union {
        struct __attribute__((packed)) {
          unsigned char duty;
          bool direction : 1;
          bool reserved : 7;
        } setSpeed;
      };
    } rxBuffer;

    Device *that;

    void init(Device *that, int axis) {
      this->that = that;
      Slave::init(0x50 + axis, 0, atsamd::i2c::AddressMode::MASK, 0, target::gclk::CLKCTRL::GEN::GCLK0, PIN_SDA,
                  PIN_SCL, target::port::PMUX::PMUXE::C);
    }

    virtual int getTxByte(int index) {
      return index < sizeof(that->state) ? ((unsigned char *)&that->state)[index] : 0;
    }

    bool commandIs(Command command, int index, int value, int paramsSize) {
      return rxBuffer.command == command && index == paramsSize;
    }

    virtual bool setRxByte(int index, int value) {

      if (index < sizeof(rxBuffer)) {
        ((unsigned char *)&rxBuffer)[index] = value;

        if (commandIs(Command::SET, index, value, sizeof(rxBuffer.setSpeed))) {
          that->state.duty = rxBuffer.setSpeed.duty;
          that->state.direction = rxBuffer.setSpeed.direction;
          that->unattendedTimeoutCounter = 0;
          that->checkState();
        }

        return true;

      } else {
        return false;
      }
    }

  } slave;

  class : public atsamd::encoder::Encoder {
  public:
    Device *that;

    void changed(int steps) {
      that->state.actSteps += steps;
      that->checkState();
    }

    void init(Device *that) {
      this->that = that;
      Encoder::init(PIN_HALL_A, PIN_HALL_B, EXT_INT_HALL_A, EXT_INT_HALL_B);
    }
  } encoder;

  class : public genericTimer::Timer {
  public:
    Device *that;
    void onTimer() {
      that->unattendedTimeoutCounter++;
      if (that->unattendedTimeoutCounter > UNATTENDED_TIMEOUT_COUNT) {
        that->state.duty = 0;
      }

      that->state.endStop1 = target::PORT.IN.getIN() >> PIN_STOP1 & 1;
      that->state.endStop2 = target::PORT.IN.getIN() >> PIN_STOP2 & 1;

      that->checkState();

      start(LO_PRIO_CHECK_MS / 10);
    }

    void init(Device *that) {
      this->that = that;
      start(LO_PRIO_CHECK_MS / 10);
    }
  } timer;

  struct __attribute__((packed)) {
    unsigned char duty;
    bool direction : 1;
    bool endStop1 : 1;
    bool endStop2 : 1;
    bool reserved : 5;
    int actSteps;
    short currentMA = 0xFFFF;
  } state;

  TB67H451FNG motor;
  int unattendedTimeoutCounter;

  void init(int axis) {

    // TC1 for motor PWM

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    // STOPs

    target::PORT.PINCFG[PIN_STOP1].setINEN(true).setPULLEN(true);
    target::PORT.PINCFG[PIN_STOP2].setINEN(true).setPULLEN(true);

    motor.init(PIN_MOTOR1, PIN_MOTOR2, &target::TC1);
    encoder.init(this);
    slave.init(this, axis);
    timer.init(this);
  }

  void checkState() {

    motor.set((state.direction && !state.endStop1) || (!state.direction && !state.endStop2) ? state.duty : 0,
              state.direction);

    bool running = state.duty != 0;
    target::PORT.OUTCLR.setOUTCLR(!running << PIN_LED);
    target::PORT.OUTSET.setOUTSET(running << PIN_LED);
  }

  void setSpeed(unsigned int speed) {}
};

Device device;

void interruptHandlerSERCOM0() { device.slave.interruptHandlerSERCOM(); }
void interruptHandlerEIC() { device.encoder.interruptHandlerEIC(); }

void initApplication() {

  // enable safeboot
  atsamd::safeboot::init(PIN_SAFEBOOT, false, PIN_LED);

  // MCU clocked at 8MHz
  target::SYSCTRL.OSC8M.setPRESC(target::sysctrl::OSC8M::PRESC::_1);
  genericTimer::clkHz = 8E6;

  device.init(atsamd::configPin::readConfigPin(PIN_ADDR));

  // enable interrupts
  target::NVIC.IPR[target::interrupts::External::SERCOM0 >> 2].setPRI(target::interrupts::External::SERCOM0 & 0x03, 3);
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::SERCOM0);
  target::NVIC.ISER.setSETENA(1 << target::interrupts::External::EIC);
}
