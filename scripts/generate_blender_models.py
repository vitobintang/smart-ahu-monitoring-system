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
                bsdf.inputs['Emission Strength'].default_value = 2.0
        elif emissive and 'Emission' in bsdf.inputs:
            bsdf.inputs['Emission'].default_value = emissive
    return mat

os.makedirs("public/models", exist_ok=True)
os.makedirs("blender", exist_ok=True)

# ==============================================================================
# 1. AC SPLIT WALL (Modern sleek split indoor unit with see-through cutaway)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_shell_white = make_mat("ShellWhite", (0.96, 0.97, 0.98, 1.0), roughness=0.2, metallic=0.05)
mat_cutaway_glass = make_mat("GlassClear", (0.85, 0.95, 1.0, 0.18), roughness=0.05, transmission=0.92)
mat_intake_dark = make_mat("IntakeDark", (0.12, 0.14, 0.18, 1.0), roughness=0.6)
mat_filter_mesh = make_mat("FilterMesh", (0.28, 0.38, 0.48, 1.0), roughness=0.6, metallic=0.1)
mat_copper = make_mat("CopperPipes", (0.85, 0.45, 0.22, 1.0), roughness=0.2, metallic=0.9)
mat_cooling_fins = make_mat("CoilFins", (0.25, 0.65, 0.92, 1.0), roughness=0.25, metallic=0.6)
mat_fan_rotor = make_mat("FanPlastic", (0.20, 0.25, 0.32, 1.0), roughness=0.35, metallic=0.1)
mat_back_metal = make_mat("SteelPlate", (0.50, 0.55, 0.60, 1.0), roughness=0.4, metallic=0.7)
mat_display = make_mat("DisplayLed", (0.2, 0.8, 1.0, 1.0), roughness=0.2, emissive=(0.2, 0.8, 1.0, 1.0))

# Back plate
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.11, 0))
back = bpy.context.active_object
back.name = "BackPlate"
back.scale = (1.06, 0.02, 0.32)
back.data.materials.append(mat_back_metal)

# Main Chassis (curved body aesthetic)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.02, 0))
body = bpy.context.active_object
body.name = "Chassis"
body.scale = (1.04, 0.16, 0.30)
body.data.materials.append(mat_shell_white)

# Front Inspection Cutaway Window (crystal clear view of cooling components)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.065, 0.01))
window = bpy.context.active_object
window.name = "FrontCutawayWindow"
window.scale = (0.98, 0.015, 0.26)
window.data.materials.append(mat_cutaway_glass)

# Top Intake Grille
for i in range(5):
    y_pos = -0.07 + (i * 0.024)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, y_pos, 0.155))
    slat = bpy.context.active_object
    slat.name = f"IntakeSlat_{i}"
    slat.scale = (0.96, 0.012, 0.008)
    slat.data.materials.append(mat_intake_dark)

# Angled Air Filter
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.01, 0.125))
filter_pad = bpy.context.active_object
filter_pad.name = "AirFilter"
filter_pad.scale = (0.94, 0.12, 0.008)
filter_pad.rotation_euler = (math.radians(-22), 0, 0)
filter_pad.data.materials.append(mat_filter_mesh)

# V-Evaporator Coil (Dual fin stack meeting at center)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.035, 0.055))
coil_f = bpy.context.active_object
coil_f.name = "EvaporatorCoil_Front"
coil_f.scale = (0.92, 0.03, 0.11)
coil_f.rotation_euler = (math.radians(32), 0, 0)
coil_f.data.materials.append(mat_cooling_fins)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.07, 0.055))
coil_b = bpy.context.active_object
coil_b.name = "EvaporatorCoil_Back"
coil_b.scale = (0.92, 0.03, 0.11)
coil_b.rotation_euler = (math.radians(-32), 0, 0)
coil_b.data.materials.append(mat_cooling_fins)

# Copper manifold pipes on side
for z_step in [-0.035, 0.005, 0.045]:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.038, location=(0.47, -0.05, 0.055 + z_step))
    pipe = bpy.context.active_object
    pipe.name = f"CopperBend_{z_step}"
    pipe.rotation_euler = (0, math.radians(90), 0)
    pipe.data.materials.append(mat_copper)

# Digital display
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.35, 0.073, 0.08))
disp = bpy.context.active_object
disp.name = "LedDisplay"
disp.scale = (0.09, 0.004, 0.035)
disp.data.materials.append(mat_display)

# ROTATING CROSS-FLOW FAN (Rotor)
# Located in the lower chamber along the X axis
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, -0.02, -0.045))
rotor_empty = bpy.context.active_object
rotor_empty.name = "Rotor"

# Central steel shaft
bpy.ops.mesh.primitive_cylinder_add(radius=0.010, depth=0.94, location=(0, -0.02, -0.045))
shaft = bpy.context.active_object
shaft.name = "RotorShaft"
shaft.rotation_euler = (0, math.radians(90), 0)
shaft.data.materials.append(mat_back_metal)
parent_keep_transform(shaft, rotor_empty)

# 12 aerodynamic fan blades arranged cylindrically around shaft
for b in range(12):
    angle = b * (math.pi * 2 / 12)
    by = math.cos(angle) * 0.042
    bz = math.sin(angle) * 0.042
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.02 + by, -0.045 + bz))
    blade = bpy.context.active_object
    blade.name = f"FanBlade_{b}"
    blade.scale = (0.92, 0.004, 0.018)
    blade.rotation_euler = (angle + 0.4, 0, 0)
    blade.data.materials.append(mat_fan_rotor)
    parent_keep_transform(blade, rotor_empty)

# MOTORIZED DISCHARGE AIR LOUVER (AirLouver)
# Pivot at the rear edge of the bottom discharge outlet
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0.035, -0.13))
louver_pivot = bpy.context.active_object
louver_pivot.name = "AirLouver"

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.055, -0.13))
vane = bpy.context.active_object
vane.name = "LouverVane"
vane.scale = (0.96, 0.045, 0.006)
vane.rotation_euler = (math.radians(20), 0, 0)
vane.data.materials.append(mat_shell_white)
parent_keep_transform(vane, louver_pivot)

bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath("blender/ac-split-wall.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ac-split-wall.glb"), export_format='GLB', export_apply=False)
print("SPLIT_WALL_SAVED")


# ==============================================================================
# 2. AHU (Air Handling Unit with crystal-clear full process see-through cutaway)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_ahu_frame = make_mat("AhuShell", (0.86, 0.89, 0.92, 1.0), roughness=0.35, metallic=0.25)
mat_ahu_cutaway = make_mat("AhuGlassCutaway", (0.88, 0.94, 1.0, 0.16), roughness=0.06, transmission=0.92)
mat_ahu_plinth = make_mat("AhuPlinth", (0.16, 0.20, 0.25, 1.0), roughness=0.55, metallic=0.6)
mat_ahu_prefilter = make_mat("PreFilter", (0.32, 0.40, 0.48, 1.0), roughness=0.7)
mat_ahu_bagfilter = make_mat("BagFilter", (0.78, 0.82, 0.86, 1.0), roughness=0.85)
mat_ahu_cool_coil = make_mat("CoolCoil", (0.18, 0.62, 0.95, 1.0), roughness=0.3, metallic=0.6)
mat_ahu_heat_coil = make_mat("HeatCoil", (0.96, 0.42, 0.16, 1.0), roughness=0.3, metallic=0.6)
mat_ahu_copper = make_mat("CopperHeader", (0.86, 0.46, 0.24, 1.0), roughness=0.2, metallic=0.9)
mat_ahu_scroll = make_mat("FanScroll", (0.28, 0.33, 0.40, 1.0), roughness=0.35, metallic=0.45)
mat_ahu_wheel = make_mat("FanWheel", (0.12, 0.52, 0.90, 1.0), roughness=0.25, metallic=0.5)
mat_ahu_damper = make_mat("DamperLouvers", (0.42, 0.48, 0.54, 1.0), roughness=0.3, metallic=0.7)

# Structural Plinth Base (with vibration isolation feet)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.58))
plinth = bpy.context.active_object
plinth.name = "PlinthFrame"
plinth.scale = (2.7, 0.96, 0.12)
plinth.data.materials.append(mat_ahu_plinth)

# Solid Back Wall (insulated panel)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.44, 0))
back_wall = bpy.context.active_object
back_wall.name = "BackWall"
back_wall.scale = (2.6, 0.04, 1.05)
back_wall.data.materials.append(mat_ahu_frame)

# Top Roof & Bottom Floor Pan
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.53))
roof = bpy.context.active_object
roof.name = "RoofPanel"
roof.scale = (2.6, 0.92, 0.04)
roof.data.materials.append(mat_ahu_frame)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.51))
floor_pan = bpy.context.active_object
floor_pan.name = "FloorPan"
floor_pan.scale = (2.6, 0.92, 0.04)
floor_pan.data.materials.append(mat_ahu_frame)

# Full Front See-Through Crystal Glass Inspection Window
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.44, 0))
glass_front = bpy.context.active_object
glass_front.name = "FrontCutawayWindow"
glass_front.scale = (2.56, 0.02, 1.0)
glass_front.data.materials.append(mat_ahu_cutaway)

# 1. Fresh Air Intake Section (Left end, X = -1.28)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.28, 0, 0))
collar_in = bpy.context.active_object
collar_in.name = "IntakeCollar"
collar_in.scale = (0.06, 0.82, 0.88)
collar_in.data.materials.append(mat_ahu_damper)

# Opposed blade dampers
for d in range(4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.24, 0, -0.32 + d * 0.22))
    damper = bpy.context.active_object
    damper.name = f"DamperBlade_{d}"
    damper.scale = (0.015, 0.80, 0.16)
    damper.rotation_euler = (0, math.radians(35), 0)
    damper.data.materials.append(mat_ahu_damper)

# 2. Filter Stage 1: Pleated Pre-Filter (X = -0.92)
bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.92, 0, 0))
pre_filter = bpy.context.active_object
pre_filter.name = "PreFilter"
pre_filter.scale = (0.05, 0.84, 0.94)
pre_filter.data.materials.append(mat_ahu_prefilter)

# 3. Filter Stage 2: Deep 4-Pocket Bag Filter (X = -0.68)
for pocket in range(4):
    y_pos = -0.30 + pocket * 0.20
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.68, y_pos, 0))
    bag = bpy.context.active_object
    bag.name = f"BagFilter_{pocket}"
    bag.scale = (0.35, 0.14, 0.92)
    bag.data.materials.append(mat_ahu_bagfilter)

# 4. Cooling Coil (Chilled water coil, X = -0.18)
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

# Copper Header pipes
bpy.ops.mesh.primitive_cylinder_add(radius=0.032, depth=0.96, location=(-0.10, 0.38, 0))
pipe_s = bpy.context.active_object
pipe_s.name = "CoolPipeSupply"
pipe_s.data.materials.append(mat_ahu_copper)

bpy.ops.mesh.primitive_cylinder_add(radius=0.032, depth=0.96, location=(-0.10, -0.38, 0))
pipe_r = bpy.context.active_object
pipe_r.name = "CoolPipeReturn"
pipe_r.data.materials.append(mat_ahu_copper)

# 5. Heating Coil Section (X = 0.20)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0.20, 0, 0))
heat_coil = bpy.context.active_object
heat_coil.name = "HeatingCoil"
heat_coil.scale = (0.08, 0.84, 0.92)
heat_coil.data.materials.append(mat_ahu_heat_coil)

# 6. Supply Centrifugal Fan Section (X = 0.82)
# Scroll casing
bpy.ops.mesh.primitive_cylinder_add(radius=0.38, depth=0.48, location=(0.82, 0, 0))
scroll = bpy.context.active_object
scroll.name = "FanScrollCasing"
scroll.rotation_euler = (math.radians(90), 0, 0)
scroll.scale = (1.0, 1.0, 0.95)
scroll.data.materials.append(mat_ahu_scroll)

# Discharge Duct collar (X = 1.25)
bpy.ops.mesh.primitive_cube_add(size=1, location=(1.25, 0, 0.12))
duct_out = bpy.context.active_object
duct_out.name = "SupplyDischargeCollar"
duct_out.scale = (0.12, 0.54, 0.54)
duct_out.data.materials.append(mat_ahu_frame)

# ROTATING IMPELLER WHEEL (Rotor)
# Centered at (0.82, 0, 0)
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0.82, 0, 0))
rotor_ahu = bpy.context.active_object
rotor_ahu.name = "Rotor"

# Impeller hub
bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=0.50, location=(0.82, 0, 0))
hub = bpy.context.active_object
hub.name = "ImpellerHub"
hub.rotation_euler = (math.radians(90), 0, 0)
hub.data.materials.append(mat_ahu_wheel)
parent_keep_transform(hub, rotor_ahu)

# 12 backward-curved fan blades
for b in range(12):
    angle = b * (math.pi * 2 / 12)
    bx = math.cos(angle) * 0.26
    bz = math.sin(angle) * 0.26
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.82 + bx, 0, bz))
    blade = bpy.context.active_object
    blade.name = f"CentrifugalBlade_{b}"
    blade.scale = (0.02, 0.44, 0.12)
    blade.rotation_euler = (0, -angle + 0.45, math.radians(90))
    blade.data.materials.append(mat_ahu_wheel)
    parent_keep_transform(blade, rotor_ahu)

bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath("blender/ahu.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ahu.glb"), export_format='GLB', export_apply=False)
print("AHU_SAVED")


# ==============================================================================
# 3. AC DAK (Ceiling Cassette)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_dak_fascia = make_mat("FasciaWhite", (0.95, 0.96, 0.98, 1.0), roughness=0.2)
mat_dak_steel = make_mat("GalvSteel", (0.55, 0.60, 0.65, 1.0), roughness=0.35, metallic=0.8)
mat_dak_coil = make_mat("CoilRing", (0.25, 0.65, 0.92, 1.0), roughness=0.25, metallic=0.6)
mat_dak_fan = make_mat("TurboFan", (0.16, 0.20, 0.26, 1.0), roughness=0.3)
mat_dak_grille = make_mat("IntakeGrille", (0.12, 0.15, 0.18, 1.0), roughness=0.6)

# Main Galvanized Steel Chassis
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.08))
chassis = bpy.context.active_object
chassis.name = "CeilingChassis"
chassis.scale = (0.84, 0.84, 0.22)
chassis.data.materials.append(mat_dak_steel)

# Ceiling suspension drop rods
for rx, ry in [(-0.36, -0.36), (0.36, -0.36), (-0.36, 0.36), (0.36, 0.36)]:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.18, location=(rx, ry, 0.24))
    rod = bpy.context.active_object
    rod.name = "DropRod"
    rod.data.materials.append(mat_dak_steel)

# Architectural Bottom Fascia Panel
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.04))
fascia = bpy.context.active_object
fascia.name = "FasciaPanel"
fascia.scale = (0.95, 0.95, 0.03)
fascia.data.materials.append(mat_dak_fascia)

# Center circular air intake grille
bpy.ops.mesh.primitive_cylinder_add(radius=0.24, depth=0.02, location=(0, 0, -0.045))
grille = bpy.context.active_object
grille.name = "CenterIntakeGrille"
grille.data.materials.append(mat_dak_grille)

# Circular Evaporator Coil Ring
bpy.ops.mesh.primitive_torus_add(major_radius=0.32, minor_radius=0.045, location=(0, 0, 0.06))
coil_ring = bpy.context.active_object
coil_ring.name = "CoilRing"
coil_ring.data.materials.append(mat_dak_coil)

# Turbo Centrifugal Fan Rotor
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0.04))
rotor_dak = bpy.context.active_object
rotor_dak.name = "Rotor"

bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.10, location=(0, 0, 0.04))
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
    bpy.ops.mesh.primitive_cube_add(size=1, location=(lx, ly, -0.048))
    louver = bpy.context.active_object
    louver.name = f"Louver_{l}"
    louver.scale = (0.55, 0.045, 0.008)
    louver.rotation_euler = (0, 0, rot)
    louver.data.materials.append(mat_dak_fascia)

bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=os.path.abspath("public/models/ac-dak.glb"), export_format='GLB', export_apply=False)
print("DAK_SAVED")


# ==============================================================================
# 4. AC STANDING (Vertical Floor Tower Unit)
# ==============================================================================
bpy.ops.wm.read_factory_settings(use_empty=True)

mat_tower_white = make_mat("TowerWhite", (0.95, 0.96, 0.98, 1.0), roughness=0.2)
mat_tower_glass = make_mat("TowerGlass", (0.88, 0.94, 1.0, 0.18), roughness=0.08, transmission=0.90)
mat_tower_coil = make_mat("CoilBlue", (0.25, 0.65, 0.92, 1.0), roughness=0.25, metallic=0.6)
mat_tower_fan = make_mat("TurboFan", (0.16, 0.20, 0.26, 1.0), roughness=0.3)
mat_tower_dark = make_mat("DarkPlinth", (0.12, 0.15, 0.18, 1.0), roughness=0.6)
mat_tower_disp = make_mat("TowerDisplay", (0.2, 0.8, 1.0, 1.0), roughness=0.2, emissive=(0.2, 0.8, 1.0, 1.0))

# Plinth Base & Casters
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.05))
plinth = bpy.context.active_object
plinth.name = "PlinthBase"
plinth.scale = (0.54, 0.46, 0.10)
plinth.data.materials.append(mat_tower_dark)

# Main Tower Chassis
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.04, 0.90))
chassis = bpy.context.active_object
chassis.name = "TowerChassis"
chassis.scale = (0.52, 0.36, 1.62)
chassis.data.materials.append(mat_tower_white)

# Front Inspection Window (crystal see-through window to watch internal coil & air process)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.15, 0.88))
win = bpy.context.active_object
win.name = "InspectionWindow"
win.scale = (0.46, 0.02, 1.38)
win.data.materials.append(mat_tower_glass)

# Front lower intake slats
for s in range(6):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.15, 0.25 + s * 0.08))
    slat = bpy.context.active_object
    slat.name = f"TowerSlat_{s}"
    slat.scale = (0.42, 0.015, 0.04)
    slat.data.materials.append(mat_tower_dark)

# Vertical cooling evaporator coil
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.82))
vcoil = bpy.context.active_object
vcoil.name = "VerticalCoil"
vcoil.scale = (0.42, 0.06, 0.88)
vcoil.data.materials.append(mat_tower_coil)

# Digital Touch Panel
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.155, 1.48))
panel = bpy.context.active_object
panel.name = "ControlPanel"
panel.scale = (0.18, 0.008, 0.06)
panel.data.materials.append(mat_tower_disp)

# Top Blower Fan Section
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
print("STANDING_SAVED")
