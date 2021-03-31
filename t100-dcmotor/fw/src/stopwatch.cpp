
class Stopwatch {
public:
  const int frequency = genericTimer::clkHz / 1024;
  const int tickUs = 1000000 / frequency;

  void init() {

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::RTC)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    target::RTC.MODE0.CTRL = target::RTC.MODE0.CTRL.bare()
                                 .setMODE(target::rtc::MODE0::CTRL::MODE::COUNT32)
                                 .setPRESCALER(target::rtc::MODE0::CTRL::PRESCALER::DIV1024);
  }

  void start() {
    target::RTC.MODE0.CTRL.setENABLE(false);
    target::RTC.MODE0.COUNT = 0;
    target::RTC.MODE0.CTRL.setENABLE(true);
  }

  int getTime() {
      return target::RTC.MODE0.COUNT * tickUs;
  }

};