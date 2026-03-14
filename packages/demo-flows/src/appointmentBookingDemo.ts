import type { TaskIntent } from "@openbrowse/contracts";
import { ScriptedPlannerGateway, createAppointmentBookingScenario } from "@openbrowse/planner";
import type { DemoDescriptor, DemoExecutionContext } from "./DemoRegistry.js";

export const APPOINTMENT_BOOKING_DEMO: DemoDescriptor = {
  id: "appointment-booking",
  label: "Appointment Booking",
  category: "booking",
  description: "Book a dentist appointment on ZocDoc. Exercises clarification and approval.",
  supportsWatch: false
};

export function createAppointmentBookingIntent(): TaskIntent {
  return {
    id: `appointment_booking_${Date.now()}`,
    source: "desktop",
    goal: "Book a dentist appointment on ZocDoc. Find available slots this week for a general cleaning. Ask the user which provider and time slot they prefer before booking.",
    constraints: [
      "managed browser profile",
      "ask for provider and time preference",
      "require approval before confirming any booking",
      "do not enter payment information"
    ],
    metadata: { demo: "appointment-booking", category: "booking" }
  };
}

function buildAppointmentBookingPageSequence() {
  const scenario = createAppointmentBookingScenario();
  const pageModels = scenario.steps.filter((step) => step.simulatedPageModel).map((step) => step.simulatedPageModel!);
  const [landingPage, resultsPage, confirmationPage] = pageModels;
  return [landingPage, landingPage, landingPage, resultsPage, resultsPage, confirmationPage, confirmationPage].filter(Boolean);
}

export function createAppointmentBookingDemoPlanner(
  context: DemoExecutionContext = { plannerDecisionCount: 0, pageObservationCount: 0 }
) {
  const scenario = createAppointmentBookingScenario();
  const planner = new ScriptedPlannerGateway(scenario, {
    initialStepIndex: context.plannerDecisionCount
  });
  const pageSequence = buildAppointmentBookingPageSequence();
  let observationIndex = context.pageObservationCount;

  return {
    planner,
    pageModelOverride: () => {
      if (observationIndex < pageSequence.length) {
        return pageSequence[observationIndex++];
      }
      return undefined;
    }
  };
}
