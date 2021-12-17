const int PIN_LED = 4;
const int PIN_ADDR = 2;
const int PIN_SAFEBOOT = 8;

const int PIN_RELAY = 5;

const int PIN_SDA = 14;
const int PIN_SCL = 15;

const int UNATTENDED_TIMEOUT_MS = 2000;

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
      Slave::init(0x60 + axis, 0, atsamd::i2c::AddressMode::MASK, 0, target::gclk::CLKCTRL::GEN::GCLK0, PIN_SDA,
                  PIN_SCL, target::port::PMUX::PMUXE::C);
    }

    virtual int getTxByte(int index) {
      return index;
    }

    virtual bool setRxByte(int index, int value) {
        if (index == 0) {
          return true;
        } else {
          return false;
        }
    }

  } slave;

  class : public genericTimer::Timer {
  public:
    Device *that;
    void onTimer() {
      start(UNATTENDED_TIMEOUT_MS / 10);
    }

    void init(Device *that) {
      this->that = that;
      start(UNATTENDED_TIMEOUT_MS / 10);
    }
  } timer;

  void init(int address) {

    // TC1 for motor PWM

    target::PM.APBCMASK.setTC(1, true);

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::TC1_TC2)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    slave.init(this, address);
    timer.init(this);
  }

};

Device device;

void interruptHandlerSERCOM0() { device.slave.interruptHandlerSERCOM(); }

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
}
