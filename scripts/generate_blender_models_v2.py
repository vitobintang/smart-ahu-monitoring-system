import bpy
import math
import os

# Helper to parent with proper matrix inverse so child keeps its world position
def parent_keep_transform(child, parent):
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()

def make_mat(name, color, roughness=0.35, metallic=0.0, transmission=0.0, alpha=1.0, emissive=None):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        if 'Transmission Weight' in bsdf.inputs:
            bsdf.inputs['Transmission Weight'].default_value = transmission
        elif 'Transmission' in bsdf.inputs:
            bsdf.inputs['Transmission'].default_value = transmission
        if emissive and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = emissive
            if 'Emission Strength' in bsdf.inputs:
                bsdf.inputs['Emission Strength'].default_value = 2.5
        elif emissive and 'Emission' in bsdf.inputs:
            bsdf.inputs['Emission'].default_value = emissive
    return mat

os.makedirs("public/models", exist_ok=True)
os.makedirs("blender", exist_ok=True)

# ==============================================================================
# 1. AC SPLIT WALL — REAL CUTAWAY CASING & FULLY VISIBLE INTERNALS
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_shell_white = make_mat("ShellWhite", (0.96, 0.97, 0.98, 1.0), roughness=0.2, metallic=0.05)
mat_cutaway_glass = make_mat("GlassClear", (0.85, 0.95, 1.0, 0.15), roughness=0.05, transmission=0.95)
mat_intake_dark = make_mat("IntakeDark", (0.12, 0.14, 0.18, 1.0), roughness=0.6)
mat_filter_mesh = make_mat("FilterMesh", (0.28, 0.50, 0.70, 0.85), roughness=0.5, transmission=0.4)
mat_copper = make_mat("CopperPipes", (0.90, 0.45, 0.20, 1.0), roughness=0.2, metallic=0.92)
mat_cooling_fins = make_mat("CoilFins", (0.20, 0.65, 0.95, 1.0), roughness=0.25, metallic=0.65)
mat_fan_rotor = make_mat("FanPlastic", (0.18, 0.24, 0.32, 1.0), roughness=0.35, metallic=0.2)
mat_back_metal = make_mat("SteelPlate", (0.45, 0.50, 0.55, 1.0), roughness=0.4, metallic=0.75)
mat_display = make_mat("DisplayLed", (0.2, 0.85, 1.0, 1.0), roughness=0.1, emissive=(0.2, 0.85, 1.0, 1.0))
mat_frame_trim = make_mat("FrameTrim", (0.88, 0.90, 0.93, 1.0), roughness=0.3, metallic=0.4)

# 1. Back mounting plate
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.10, 0))
back = bpy.context.active_object
back.name = "BackPlate"
back.scale = (1.06, 0.015, 0.32)
back.data.materials.append(mat_back_metal)

# 2. Side end caps (Left & Right only — FRONT IS NOT SOLID)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.515, 0.01, 0))
side_l = bpy.context.active_object
side_l.name = "SideCap_Left"
side_l.scale = (0.03, 0.21, 0.32)
side_l.data.materials.append(mat_shell_white)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0.515, 0.01, 0))
side_r = bpy.context.active_object
side_r.name = "SideCap_Right"
side_r.scale = (0.03, 0.21, 0.32)
side_r.data.materials.append(mat_shell_white)

# 3. Top curved hood & bottom drain tray (Frame only)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.02, 0.155))
top_hood = bpy.context.active_object
top_hood.name = "TopHood"
top_hood.scale = (1.00, 0.15, 0.02)
top_hood.data.materials.append(mat_shell_white)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.01, -0.155))
bot_tray = bpy.context.active_object
bot_tray.name = "BottomDrainTray"
bot_tray.scale = (1.00, 0.19, 0.02)
bot_tray.data.materials.append(mat_shell_white)

# 4. FRONT INSPECTION GLASS WINDOW (Crystal clear viewing wall into the coils and fan)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.105, 0.005))
front_glass = bpy.context.active_object
front_glass.name = "FrontCutawayWindow"
front_glass.scale = (1.00, 0.008, 0.29)
front_glass.data.materials.append(mat_cutaway_glass)

# Glass frame border
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.108, 0.145))
trim_top = bpy.context.active_object
trim_top.name = "TrimTop"
trim_top.scale = (1.00, 0.012, 0.012)
trim_top.data.materials.append(mat_frame_trim)

# 5. Top intake louvers
for i in range(5):
    y_pos = -0.07 + (i * 0.024)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, y_pos, 0.165))
    slat = bpy.context.active_object
    slat.name = f"IntakeSlat_{i}"
    slat.scale = (0.96, 0.010, 0.008)
    slat.data.materials.append(mat_intake_dark)

# 6. Fine air filter mesh (angled directly under the intake slats)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.01, 0.125))
filter_pad = bpy.context.active_object
filter_pad.name = "AirFilter"
filter_pad.scale = (0.94, 0.13, 0.006)
filter_pad.rotation_euler = (math.radians(-22), 0, 0)
filter_pad.data.materials.append(mat_filter_mesh)

# 7. V-Evaporator Cooling Coil (Distinct blue fin banks with space between them)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.035, 0.045))
coil_f = bpy.context.active_object
coil_f.name = "EvaporatorCoil_Front"
coil_f.scale = (0.92, 0.028, 0.12)
coil_f.rotation_euler = (math.radians(30), 0, 0)
coil_f.data.materials.append(mat_cooling_fins)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.070, 0.045))
coil_b = bpy.context.active_object
coil_b.name = "EvaporatorCoil_Back"
coil_b.scale = (0.92, 0.028, 0.12)
coil_b.rotation_euler = (math.radians(-30), 0, 0)
coil_b.data.materials.append(mat_cooling_fins)

# Copper tube U-bends on both ends
for x_side in [-0.46, 0.46]:
    for z_step in [-0.03, 0.01, 0.05]:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.035, location=(x_side, -0.05, 0.045 + z_step))
        pipe = bpy.context.active_object
        pipe.name = f"CopperBend_{x_side}_{z_step}"
        pipe.rotation_euler = (0, math.radians(90), 0)
        pipe.data.materials.append(mat_copper)

# Digital Temperature LED on the right cap
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.42, 0.108, 0.07))
disp = bpy.context.active_object
disp.name = "LedDisplay"
disp.scale = (0.10, 0.004, 0.04)
disp.data.materials.append(mat_display)

# 8. ROTATING CROSS-FLOW FAN (Rotor)
# Located below the evaporator coil, spinning along X-axis
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0.01, -0.05))
rotor_empty = bpy.context.active_object
rotor_empty.name = "Rotor"

# Steel axle shaft
bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.94, location=(0, 0.01, -0.05))
shaft = bpy.context.active_object
shaft.name = "RotorShaft"
shaft.rotation_euler = (0, math.radians(90), 0)
shaft.data.materials.append(mat_back_metal)
parent_keep_transform(shaft, rotor_empty)

# 16 pitched aerodynamic curved blades forming the cross-flow cage
for b in range(16):
    angle = b * (math.pi * 2 / 16)
    by = math.cos(angle) * 0.042
    bz = math.sin(angle) * 0.042
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.01 + by, -0.05 + bz))
    blade = bpy.context.active_object
    blade.name = f"FanBlade_{b}"
    blade.scale = (0.92, 0.004, 0.018)
    blade.rotation_euler = (angle + 0.35, 0, 0)
    blade.data.materials.append(mat_fan_rotor)
    parent_keep_transform(blade, rotor_empty)

# 9. MOTORIZED DISCHARGE AIR LOUVER (AirLouver)
# At the bottom-front discharge outlet
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0.065, -0.14))
louver_pivot = bpy.context.active_object
louver_pivot.name = "AirLouver"

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.085, -0.14))
vane = bpy.context.active_object
vane.name = "LouverVane"
vane.scale = (0.96, 0.045, 0.006)
vane.rotation_euler = (math.radians(25), 0, 0)
vane.data.materials.append(mat_shell_white)
parent_keep_transform(vane, louver_pivot)

bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath("blender/ac-split-wall.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ac-split-wall.glb"), export_format='GLB', export_apply=False)
print("AC_SPLIT_WALL_SAVED")


# ==============================================================================
# 2. AHU — AIRFLOW-ALIGNED PLUG FAN & COMPLETE PROCESS GLASS CUTAWAY
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_ahu_frame = make_mat("AhuFrame", (0.75, 0.78, 0.82, 1.0), roughness=0.3, metallic=0.7)
mat_ahu_panel = make_mat("AhuPanel", (0.88, 0.90, 0.92, 1.0), roughness=0.35, metallic=0.15)
mat_ahu_cutaway = make_mat("AhuGlassCutaway", (0.85, 0.94, 1.0, 0.12), roughness=0.04, transmission=0.96)
mat_ahu_plinth = make_mat("AhuPlinth", (0.15, 0.18, 0.22, 1.0), roughness=0.55, metallic=0.6)
mat_ahu_prefilter = make_mat("PreFilter", (0.30, 0.40, 0.50, 1.0), roughness=0.7)
mat_ahu_bagfilter = make_mat("BagFilter", (0.80, 0.84, 0.88, 1.0), roughness=0.8)
mat_ahu_cool_coil = make_mat("CoolCoil", (0.15, 0.60, 0.95, 1.0), roughness=0.25, metallic=0.7)
mat_ahu_heat_coil = make_mat("HeatCoil", (0.95, 0.42, 0.15, 1.0), roughness=0.3, metallic=0.65)
mat_ahu_copper = make_mat("CopperHeader", (0.88, 0.48, 0.22, 1.0), roughness=0.2, metallic=0.92)
mat_ahu_fan_cone = make_mat("FanInletCone", (0.22, 0.26, 0.32, 1.0), roughness=0.35, metallic=0.5)
mat_ahu_fan_wheel = make_mat("FanWheel", (0.10, 0.55, 0.92, 1.0), roughness=0.2, metallic=0.6)
mat_ahu_motor = make_mat("FanMotor", (0.18, 0.22, 0.26, 1.0), roughness=0.4, metallic=0.5)
mat_ahu_damper = make_mat("DamperLouvers", (0.40, 0.46, 0.52, 1.0), roughness=0.3, metallic=0.7)

# Structural Plinth Base
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.58))
plinth = bpy.context.active_object
plinth.name = "PlinthFrame"
plinth.scale = (2.7, 0.96, 0.12)
plinth.data.materials.append(mat_ahu_plinth)

# 6 Vibration isolator feet under the plinth
for fx in [-1.1, 0, 1.1]:
    for fy in [-0.38, 0.38]:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=0.06, location=(fx, fy, -0.67))
        foot = bpy.context.active_object
        foot.name = f"IsoFoot_{fx}_{fy}"
        foot.data.materials.append(mat_ahu_plinth)

# Extruded Structural Frame (Box corners)
for cx in [-1.30, 1.30]:
    for cy in [-0.44, 0.44]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy, 0))
        post = bpy.context.active_object
        post.name = f"CornerPost_{cx}_{cy}"
        post.scale = (0.05, 0.05, 1.05)
        post.data.materials.append(mat_ahu_frame)

# Solid Back Wall, Roof, and Floor Pan
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.45, 0))
back_wall = bpy.context.active_object
back_wall.name = "BackWall"
back_wall.scale = (2.6, 0.03, 1.05)
back_wall.data.materials.append(mat_ahu_panel)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.53))
roof = bpy.context.active_object
roof.name = "RoofPanel"
roof.scale = (2.6, 0.92, 0.03)
roof.data.materials.append(mat_ahu_panel)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.51))
floor_pan = bpy.context.active_object
floor_pan.name = "FloorPan"
floor_pan.scale = (2.6, 0.92, 0.03)
floor_pan.data.materials.append(mat_ahu_panel)

# FULL FRONT VIEWING GLASS WALL (Zero opaque obstructions)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.45, 0))
glass_front = bpy.context.active_object
glass_front.name = "FrontCutawayWindow"
glass_front.scale = (2.56, 0.008, 1.02)
glass_front.data.materials.append(mat_ahu_cutaway)

# Aluminum divider frames on the glass door
for div_x in [-0.78, -0.05, 0.55]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(div_x, 0.455, 0))
    muntin = bpy.context.active_object
    muntin.name = f"GlassMuntin_{div_x}"
    muntin.scale = (0.02, 0.015, 1.02)
    muntin.data.materials.append(mat_ahu_frame)

# 1. Fresh air intake section (Left end, X = -1.28)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.28, 0, 0))
collar_in = bpy.context.active_object
collar_in.name = "IntakeCollar"
collar_in.scale = (0.05, 0.82, 0.88)
collar_in.data.materials.append(mat_ahu_damper)

# Opposed blade dampers
for d in range(4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.24, 0, -0.33 + d * 0.22))
    damper = bpy.context.active_object
    damper.name = f"DamperBlade_{d}"
    damper.scale = (0.015, 0.80, 0.16)
    damper.rotation_euler = (0, math.radians(35), 0)
    damper.data.materials.append(mat_ahu_damper)

# 2. Stage 1: Pleated Pre-Filter (X = -0.92)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.92, 0, 0))
pre_filter = bpy.context.active_object
pre_filter.name = "PreFilter"
pre_filter.scale = (0.05, 0.84, 0.94)
pre_filter.data.materials.append(mat_ahu_prefilter)

# 3. Stage 2: Deep 4-Pocket Bag Filter (X = -0.68)
for pocket in range(4):
    y_pos = -0.30 + pocket * 0.20
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.68, y_pos, 0))
    bag = bpy.context.active_object
    bag.name = f"BagFilter_{pocket}"
    bag.scale = (0.35, 0.14, 0.92)
    bag.data.materials.append(mat_ahu_bagfilter)

# 4. Stage 3: Chilled Water Cooling Coil (X = -0.18)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.18, 0, 0))
cool_coil = bpy.context.active_object
cool_coil.name = "CoolingCoil"
cool_coil.scale = (0.12, 0.84, 0.92)
cool_coil.data.materials.append(mat_ahu_cool_coil)

# Stainless Condensate Drain Tray under cooling coil
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.18, 0, -0.47))
tray = bpy.context.active_object
tray.name = "CondensateTray"
tray.scale = (0.30, 0.88, 0.04)
tray.data.materials.append(mat_ahu_plinth)

# Copper Header pipes (Supply & Return manifolds)
bpy.ops.mesh.primitive_cylinder_add(radius=0.032, depth=0.96, location=(-0.10, 0.38, 0))
pipe_s = bpy.context.active_object
pipe_s.name = "CoolPipeSupply"
pipe_s.data.materials.append(mat_ahu_copper)

bpy.ops.mesh.primitive_cylinder_add(radius=0.032, depth=0.96, location=(-0.10, -0.38, 0))
pipe_r = bpy.context.active_object
pipe_r.name = "CoolPipeReturn"
pipe_r.data.materials.append(mat_ahu_copper)

# 5. Stage 4: Heating Coil Section (X = 0.20)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.20, 0, 0))
heat_coil = bpy.context.active_object
heat_coil.name = "HeatingCoil"
heat_coil.scale = (0.08, 0.84, 0.92)
heat_coil.data.materials.append(mat_ahu_heat_coil)

# 6. Stage 5: DIRECT-DRIVE SUPPLY PLUG FAN — FACING DIRECTLY ALONG AIRFLOW (X-AXIS)!
# Aerodynamic inlet bell mouth cone facing the upstream coils (-X)
bpy.ops.mesh.primitive_cylinder_add(radius=0.34, depth=0.10, location=(0.52, 0, 0))
inlet_cone = bpy.context.active_object
inlet_cone.name = "FanInletCone"
inlet_cone.rotation_euler = (0, math.radians(90), 0)
inlet_cone.data.materials.append(mat_ahu_fan_cone)

# Electric drive motor pedestal & motor housing behind the fan wheel
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.95, 0, -0.30))
pedestal = bpy.context.active_object
pedestal.name = "MotorPedestal"
pedestal.scale = (0.36, 0.40, 0.38)
pedestal.data.materials.append(mat_ahu_plinth)

bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=0.32, location=(0.95, 0, 0))
motor = bpy.context.active_object
motor.name = "FanMotor"
motor.rotation_euler = (0, math.radians(90), 0)
motor.data.materials.append(mat_ahu_motor)

# ROTATING IMPELLER WHEEL (Rotor)
# Centered at (0.68, 0, 0), facing directly along X-axis!
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0.68, 0, 0))
rotor_ahu = bpy.context.active_object
rotor_ahu.name = "Rotor"

# Impeller backplate & hub
bpy.ops.mesh.primitive_cylinder_add(radius=0.32, depth=0.03, location=(0.76, 0, 0))
backplate = bpy.context.active_object
backplate.name = "ImpellerBackplate"
backplate.rotation_euler = (0, math.radians(90), 0)
backplate.data.materials.append(mat_ahu_fan_wheel)
parent_keep_transform(backplate, rotor_ahu)

bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=0.20, location=(0.70, 0, 0))
hub = bpy.context.active_object
hub.name = "ImpellerHub"
hub.rotation_euler = (0, math.radians(90), 0)
hub.data.materials.append(mat_ahu_fan_wheel)
parent_keep_transform(hub, rotor_ahu)

# 8 Backward-curved 3D aerodynamic plug-fan blades
for b in range(8):
    angle = b * (math.pi * 2 / 8)
    by = math.cos(angle) * 0.22
    bz = math.sin(angle) * 0.22
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.68, by, bz))
    blade = bpy.context.active_object
    blade.name = f"PlugBlade_{b}"
    blade.scale = (0.16, 0.015, 0.12)
    blade.rotation_euler = (angle + 0.45, math.radians(20), 0)
    blade.data.materials.append(mat_ahu_fan_wheel)
    parent_keep_transform(blade, rotor_ahu)

# 7. Supply discharge collar (Right end, X = 1.25)
bpy.ops.mesh.primitive_cube_add(size=1, location=(1.25, 0, 0))
duct_out = bpy.context.active_object
duct_out.name = "SupplyDischargeCollar"
duct_out.scale = (0.10, 0.64, 0.64)
duct_out.data.materials.append(mat_ahu_panel)

bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath("blender/ahu.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ahu.glb"), export_format='GLB', export_apply=False)
print("AHU_SAVED")


# ==============================================================================
# 3. AC DAK — CEILING CASSETTE (REAL FASCIA & VISIBLE COIL RING)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_dak_fascia = make_mat("FasciaWhite", (0.96, 0.97, 0.98, 1.0), roughness=0.2)
mat_dak_steel = make_mat("GalvSteel", (0.55, 0.60, 0.65, 1.0), roughness=0.35, metallic=0.8)
mat_dak_coil = make_mat("CoilRing", (0.20, 0.65, 0.95, 1.0), roughness=0.25, metallic=0.7)
mat_dak_fan = make_mat("TurboFan", (0.16, 0.22, 0.30, 1.0), roughness=0.3, metallic=0.3)
mat_dak_grille = make_mat("IntakeGrille", (0.15, 0.18, 0.22, 1.0), roughness=0.5)

# Galvanized steel top chassis (above ceiling level)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.12))
chassis = bpy.context.active_object
chassis.name = "CeilingChassis"
chassis.scale = (0.84, 0.84, 0.18)
chassis.data.materials.append(mat_dak_steel)

# 4 Suspension drop rods
for rx, ry in [(-0.38, -0.38), (0.38, -0.38), (-0.38, 0.38), (0.38, 0.38)]:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.010, depth=0.22, location=(rx, ry, 0.24))
    rod = bpy.context.active_object
    rod.name = f"DropRod_{rx}_{ry}"
    rod.data.materials.append(mat_dak_steel)

# Bottom Fascia Panel with center opening (so coil & fan are visible!)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.01))
fascia = bpy.context.active_object
fascia.name = "FasciaPanel"
fascia.scale = (0.95, 0.95, 0.02)
fascia.data.materials.append(mat_dak_fascia)

# Center circular air intake grille (recessed)
bpy.ops.mesh.primitive_cylinder_add(radius=0.24, depth=0.015, location=(0, 0, 0.005))
grille = bpy.context.active_object
grille.name = "CenterIntakeGrille"
grille.data.materials.append(mat_dak_grille)

# Concentric intake slat ring
for r in [0.08, 0.16]:
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.006, location=(0, 0, -0.005))
    sring = bpy.context.active_object
    sring.name = f"IntakeRing_{r}"
    sring.data.materials.append(mat_dak_fascia)

# Circular Evaporator Coil Ring (Surrounding the central fan)
bpy.ops.mesh.primitive_torus_add(major_radius=0.31, minor_radius=0.045, location=(0, 0, 0.07))
coil_ring = bpy.context.active_object
coil_ring.name = "CoilRing"
coil_ring.data.materials.append(mat_dak_coil)

# Turbo Centrifugal Fan Rotor (spinning on vertical Z-axis in Blender -> Y-axis in Three.js)
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0.06))
rotor_dak = bpy.context.active_object
rotor_dak.name = "Rotor"

bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.09, location=(0, 0, 0.06))
wheel = bpy.context.active_object
wheel.name = "TurboFanWheel"
wheel.data.materials.append(mat_dak_fan)
parent_keep_transform(wheel, rotor_dak)

# 4-way motorized discharge louvers
for l, (lx, ly, rot) in enumerate([
    (0, 0.38, 0),
    (0, -0.38, math.pi),
    (0.38, 0, -math.pi/2),
    (-0.38, 0, math.pi/2)
]):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(lx, ly, 0.005))
    louver = bpy.context.active_object
    louver.name = f"Louver_{l}"
    louver.scale = (0.55, 0.045, 0.008)
    louver.rotation_euler = (0, 0, rot)
    louver.data.materials.append(mat_dak_fascia)

bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ac-dak.glb"), export_format='GLB', export_apply=False)
print("AC_DAK_SAVED")


# ==============================================================================
# 4. AC STANDING — FLOOR TOWER (CLEAR GLASS DOOR & VISIBLE VERTICAL COIL)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_tower_white = make_mat("TowerWhite", (0.96, 0.97, 0.98, 1.0), roughness=0.2)
mat_tower_glass = make_mat("TowerGlass", (0.85, 0.94, 1.0, 0.15), roughness=0.05, transmission=0.95)
mat_tower_coil = make_mat("CoilBlue", (0.20, 0.65, 0.95, 1.0), roughness=0.25, metallic=0.7)
mat_tower_fan = make_mat("TurboFan", (0.16, 0.20, 0.26, 1.0), roughness=0.3)
mat_tower_dark = make_mat("DarkPlinth", (0.14, 0.16, 0.20, 1.0), roughness=0.6)
mat_tower_disp = make_mat("TowerDisplay", (0.2, 0.85, 1.0, 1.0), roughness=0.1, emissive=(0.2, 0.85, 1.0, 1.0))
mat_copper_pipe = make_mat("TowerCopper", (0.90, 0.45, 0.20, 1.0), roughness=0.2, metallic=0.92)

# Plinth Base & Casters
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.05))
plinth = bpy.context.active_object
plinth.name = "PlinthBase"
plinth.scale = (0.54, 0.46, 0.10)
plinth.data.materials.append(mat_tower_dark)

for cx in [-0.20, 0.20]:
    for cy in [-0.17, 0.17]:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.04, location=(cx, cy, 0.02))
        caster = bpy.context.active_object
        caster.name = f"Caster_{cx}_{cy}"
        caster.data.materials.append(mat_tower_dark)

# Back and Side casing panels (FRONT IS NOT A SOLID BOX)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.19, 0.90))
back_p = bpy.context.active_object
back_p.name = "TowerBack"
back_p.scale = (0.52, 0.03, 1.62)
back_p.data.materials.append(mat_tower_white)

for sx in [-0.25, 0.25]:
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sx, -0.04, 0.90))
    side_p = bpy.context.active_object
    side_p.name = f"TowerSide_{sx}"
    side_p.scale = (0.02, 0.32, 1.62)
    side_p.data.materials.append(mat_tower_white)

# FRONT VIEWING GLASS DOOR (Crystal clear reveal of internal coil and airflow path)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.12, 0.90))
win = bpy.context.active_object
win.name = "InspectionWindow"
win.scale = (0.48, 0.008, 1.48)
win.data.materials.append(mat_tower_glass)

# Lower front intake slats
for s in range(6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.125, 0.22 + s * 0.07))
    slat = bpy.context.active_object
    slat.name = f"TowerSlat_{s}"
    slat.scale = (0.42, 0.012, 0.035)
    slat.data.materials.append(mat_tower_dark)

# Vertical cooling evaporator coil (Fully visible behind the glass)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.02, 0.85))
vcoil = bpy.context.active_object
vcoil.name = "VerticalCoil"
vcoil.scale = (0.42, 0.06, 0.92)
vcoil.data.materials.append(mat_tower_coil)

# Copper tubes running along the vertical coil
for px in [-0.18, 0.18]:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.96, location=(px, 0.02, 0.85))
    cpipe = bpy.context.active_object
    cpipe.name = f"CoilHeader_{px}"
    cpipe.data.materials.append(mat_copper_pipe)

# Upper Digital Touch Display
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.125, 1.46))
panel = bpy.context.active_object
panel.name = "ControlPanel"
panel.scale = (0.22, 0.006, 0.07)
panel.data.materials.append(mat_tower_disp)

# Top Blower Collar
bpy.ops.mesh.primitive_cylinder_add(radius=0.20, depth=0.08, location=(0, 0, 1.74))
collar = bpy.context.active_object
collar.name = "TopCollar"
collar.data.materials.append(mat_tower_dark)

# ROTATING TOP BLOWER (Rotor)
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 1.74))
rotor_tower = bpy.context.active_object
rotor_tower.name = "Rotor"

bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.10, location=(0, 0, 1.74))
top_wheel = bpy.context.active_object
top_wheel.name = "TopBlower"
top_wheel.data.materials.append(mat_tower_fan)
parent_keep_transform(top_wheel, rotor_tower)

bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ac-standing.glb"), export_format='GLB', export_apply=False)
print("AC_STANDING_SAVED")
