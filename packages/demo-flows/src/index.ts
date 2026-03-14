export { DefaultDemoRegistry, type DemoRegistry, type DemoDescriptor, type DemoEntry } from "./DemoRegistry.js";
export {
  TRAVEL_SEARCH_DEMO,
  createTravelSearchIntent,
  createTravelSearchDemoPlanner
} from "./travelSearchDemo.js";
export {
  APPOINTMENT_BOOKING_DEMO,
  createAppointmentBookingIntent,
  createAppointmentBookingDemoPlanner
} from "./appointmentBookingDemo.js";
export {
  PRICE_MONITOR_DEMO,
  createPriceMonitorIntent,
  createPriceMonitorDemoPlanner,
  registerPriceMonitorWatch
} from "./priceMonitorDemo.js";

import { DefaultDemoRegistry } from "./DemoRegistry.js";
import { TRAVEL_SEARCH_DEMO, createTravelSearchIntent, createTravelSearchDemoPlanner } from "./travelSearchDemo.js";
import { APPOINTMENT_BOOKING_DEMO, createAppointmentBookingIntent, createAppointmentBookingDemoPlanner } from "./appointmentBookingDemo.js";
import { PRICE_MONITOR_DEMO, createPriceMonitorIntent, createPriceMonitorDemoPlanner, registerPriceMonitorWatch } from "./priceMonitorDemo.js";

export function createDefaultDemoRegistry(): DefaultDemoRegistry {
  const registry = new DefaultDemoRegistry();

  registry.register({
    descriptor: TRAVEL_SEARCH_DEMO,
    createIntent: createTravelSearchIntent,
    createDemoPlanner: createTravelSearchDemoPlanner
  });

  registry.register({
    descriptor: APPOINTMENT_BOOKING_DEMO,
    createIntent: createAppointmentBookingIntent,
    createDemoPlanner: createAppointmentBookingDemoPlanner
  });

  registry.register({
    descriptor: PRICE_MONITOR_DEMO,
    createIntent: createPriceMonitorIntent,
    createDemoPlanner: createPriceMonitorDemoPlanner,
    registerWatch: registerPriceMonitorWatch
  });

  return registry;
}
